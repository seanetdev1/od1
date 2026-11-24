const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');
const { sweep } = require('../../functions/taskEscalation');

/**
 * The four follow-ups: a status vocabulary, an audit trail, deadlines that do
 * something, and recurrence.
 */
describe('Task lifecycle', () => {
  let manager, worker;

  beforeAll(async () => {
    manager = await loginAs('manager');
    worker = await loginAs('employee');
  });

  afterAll(async () => {
    const ids = [manager.employee.id, worker.employee.id];
    await db.Tasks.destroy({ where: { EmployeeId: ids } });
    await db.Notifications.destroy({ where: { recipientId: ids } });
  });

  const make = (overrides = {}) =>
    request(app)
      .post('/tasks/create')
      .set('Authorization', manager.authHeader)
      .send({
        title: `${TEST_PREFIX}f`,
        EmployeeId: worker.employee.id,
        hardDeadline: '2026-09-15T00:00:00.000Z',
        ...overrides,
      });

  describe('status vocabulary', () => {
    it('rejects a status that is not in the list', async () => {
      const res = await make({ status: 'Complete' });
      expect(res.status).toBe(400);
      expect(res.body.result).toContain('Unknown status');
    });

    it('accepts a different case and stores the canonical spelling', async () => {
      const res = await make({ status: 'backlog' });
      expect(res.status).toBe(200);
      const row = await db.Tasks.findByPk(res.body.result.id);
      expect(row.status).toBe('Backlog');
    });

    it('rejects an unknown status on a status change too', async () => {
      const created = await make();
      const res = await request(app)
        .post('/tasks/changeTaskStatus')
        .set('Authorization', worker.authHeader)
        .send({ id: created.body.result.id, status: 'Finished' });
      expect(res.status).toBe(400);
    });
  });

  describe('history', () => {
    it('records creation and who did it', async () => {
      const created = await make({ title: `${TEST_PREFIX}hist` });
      const res = await request(app)
        .get(`/tasks/${created.body.result.id}/history`)
        .set('Authorization', worker.authHeader);

      expect(res.status).toBe(200);
      expect(res.body.result[0].action).toBe('created');
      expect(res.body.result[0].actorName).toBe(manager.employee.name);
    });

    it('records a status change with the value it moved from', async () => {
      const created = await make({ title: `${TEST_PREFIX}hist2` });
      await request(app)
        .post('/tasks/changeTaskStatus')
        .set('Authorization', worker.authHeader)
        .send({ id: created.body.result.id, status: 'In-progress' });

      const res = await request(app)
        .get(`/tasks/${created.body.result.id}/history`)
        .set('Authorization', worker.authHeader);

      const change = res.body.result.find((r) => r.action === 'status');
      expect(change).toBeDefined();
      expect(change.fromValue).toBe('Backlog');
      expect(change.toValue).toBe('In-progress');
      // The actor is whoever made the change, not whoever owns the task.
      expect(change.actorName).toBe(worker.employee.name);
    });

    it('does not show history to an unrelated employee', async () => {
      const outsider = await loginAs('employee');
      const created = await make();
      const res = await request(app)
        .get(`/tasks/${created.body.result.id}/history`)
        .set('Authorization', outsider.authHeader);
      expect(res.status).toBe(403);
    });
  });

  describe('deadline escalation', () => {
    it('notifies the assignee when the hard deadline has passed, exactly once', async () => {
      const created = await make({
        title: `${TEST_PREFIX}late`,
        hardDeadline: '2020-01-01T00:00:00.000Z',
      });
      const taskId = created.body.result.id;

      expect((await sweep()).ran).toBe(true);

      const where = {
        recipientId: worker.employee.id,
        recordId: String(taskId),
        subType: 'overdue',
      };
      expect(await db.Notifications.count({ where })).toBe(1);

      // Twice must not mean two notifications. Without the notifiedAt stamp an
      // overdue task would announce itself every sweep until someone closed
      // it, and people would learn to ignore the bell.
      await sweep();
      expect(await db.Notifications.count({ where })).toBe(1);
    });

    it('leaves a completed task alone however overdue it was', async () => {
      const created = await make({
        title: `${TEST_PREFIX}lateDone`,
        hardDeadline: '2020-01-01T00:00:00.000Z',
        status: 'Done',
      });
      await sweep();
      const count = await db.Notifications.count({
        where: { recordId: String(created.body.result.id), subType: 'overdue' },
      });
      expect(count).toBe(0);
    });

    it('nudges on a passed soft deadline without calling it overdue', async () => {
      const created = await make({
        title: `${TEST_PREFIX}soft`,
        softDeadline: '2020-01-01T00:00:00.000Z',
        hardDeadline: '2099-01-01T00:00:00.000Z',
      });
      await sweep();

      const base = { recordId: String(created.body.result.id) };
      expect(await db.Notifications.count({ where: { ...base, subType: 'due' } })).toBe(1);
      expect(await db.Notifications.count({ where: { ...base, subType: 'overdue' } })).toBe(0);
    });
  });

  describe('recurrence', () => {
    it('creates the next occurrence when a recurring task is completed', async () => {
      const created = await make({
        title: `${TEST_PREFIX}monthly`,
        recurrence: 'monthly',
        softDeadline: '2026-03-10T09:00:00.000Z',
        hardDeadline: '2026-03-15T09:00:00.000Z',
      });

      const res = await request(app)
        .post('/tasks/changeTaskStatus')
        .set('Authorization', worker.authHeader)
        .send({ id: created.body.result.id, status: 'Done' });

      expect(res.status).toBe(200);
      expect(res.body.result.nextTaskId).toBeDefined();

      const next = await db.Tasks.findByPk(res.body.result.nextTaskId);
      expect(next.status).toBe('Backlog');
      expect(next.parentTaskId).toBe(created.body.result.id);
      // Advanced from the ORIGINAL deadlines, not from today - a task closed
      // late must not drag the whole schedule with it.
      expect(next.hardDeadline.toISOString()).toBe('2026-04-15T09:00:00.000Z');
      expect(next.softDeadline.toISOString()).toBe('2026-04-10T09:00:00.000Z');
    });

    it('does not recur a one-off', async () => {
      const created = await make({ title: `${TEST_PREFIX}once` });
      const res = await request(app)
        .post('/tasks/changeTaskStatus')
        .set('Authorization', worker.authHeader)
        .send({ id: created.body.result.id, status: 'Done' });
      expect(res.body.result).toBeUndefined();
    });

    it('stops once recurrenceUntil has passed', async () => {
      const created = await make({
        title: `${TEST_PREFIX}until`,
        recurrence: 'monthly',
        hardDeadline: '2026-03-15T09:00:00.000Z',
        recurrenceUntil: '2026-03-20T00:00:00.000Z',
      });
      const res = await request(app)
        .post('/tasks/changeTaskStatus')
        .set('Authorization', worker.authHeader)
        .send({ id: created.body.result.id, status: 'Done' });

      // The next one would fall on 15 April, past the 20 March cut-off.
      expect(res.body.result).toBeUndefined();
    });

    it('does not clone a recurring task with no deadline to advance', async () => {
      // Otherwise it would clone itself every time anyone closed it, forever.
      const created = await make({
        title: `${TEST_PREFIX}nodate`,
        recurrence: 'weekly',
        hardDeadline: null,
      });
      const res = await request(app)
        .post('/tasks/changeTaskStatus')
        .set('Authorization', worker.authHeader)
        .send({ id: created.body.result.id, status: 'Done' });
      expect(res.body.result).toBeUndefined();
    });

    it('rejects an unknown recurrence rather than storing it', async () => {
      const res = await make({ recurrence: 'fortnightly' });
      expect(res.status).toBe(400);
      expect(res.body.result).toContain('Unknown recurrence');
    });
  });
});
