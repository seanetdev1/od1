const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

/**
 * Tasks: who may do what, and does an assignee actually get told.
 *
 * The access-control cases matter most. Before this feature none of the task
 * routes had any guard: any authenticated user could create a task, reassign
 * someone else's, or read another employee's task list by putting their id in
 * a header. Those are the first three describe blocks.
 */
describe('Tasks', () => {
  let manager, worker, other;

  beforeAll(async () => {
    manager = await loginAs('manager');
    worker = await loginAs('employee');
    other = await loginAs('employee');
  });

  afterAll(async () => {
    // Tasks created here reference the test employees, which the shared
    // teardown deletes - remove them first or the delete is blocked.
    const ids = [manager, worker, other].map((u) => u.employee.id);
    await db.Tasks.destroy({ where: { EmployeeId: ids } });
    await db.Notifications.destroy({ where: { recipientId: ids } });
  });

  const newTask = (overrides = {}) => ({
    title: `${TEST_PREFIX}task`,
    description: 'Check the thing and report back.',
    priority: 'High',
    softDeadline: '2026-09-01T00:00:00.000Z',
    hardDeadline: '2026-09-15T00:00:00.000Z',
    EmployeeId: worker.employee.id,
    ...overrides,
  });

  describe('creating', () => {
    it('lets a manager create a task', async () => {
      const res = await request(app)
        .post('/tasks/create')
        .set('Authorization', manager.authHeader)
        .send(newTask());
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.result.id).toBeDefined();
    });

    it('blocks a non-manager from creating one', async () => {
      const res = await request(app)
        .post('/tasks/create')
        .set('Authorization', worker.authHeader)
        .send(newTask());
      expect(res.status).toBe(403);
    });

    it('rejects a task with no title rather than storing a blank one', async () => {
      const res = await request(app)
        .post('/tasks/create')
        .set('Authorization', manager.authHeader)
        .send(newTask({ title: '   ' }));
      expect(res.status).toBe(400);
    });

    it('stores both deadlines as dates, not strings', async () => {
      const res = await request(app)
        .post('/tasks/create')
        .set('Authorization', manager.authHeader)
        .send(newTask({ title: `${TEST_PREFIX}dates` }));

      const row = await db.Tasks.findByPk(res.body.result.id);
      // `due` was a STRING and could not be ordered or compared by the
      // database. These must be real dates.
      expect(row.softDeadline).toBeInstanceOf(Date);
      expect(row.hardDeadline).toBeInstanceOf(Date);
      expect(row.hardDeadline.getTime()).toBeGreaterThan(row.softDeadline.getTime());
    });
  });

  describe('notifying the assignee', () => {
    it('creates a notification addressed to the assignee', async () => {
      const res = await request(app)
        .post('/tasks/create')
        .set('Authorization', manager.authHeader)
        .send(newTask({ title: `${TEST_PREFIX}notify` }));

      const note = await db.Notifications.findOne({
        where: { recipientId: worker.employee.id, recordId: String(res.body.result.id) },
      });
      expect(note).not.toBeNull();
      expect(note.type).toBe('Task');
      expect(note.notification).toContain(`${TEST_PREFIX}notify`);
    });

    it('does not show that notification to a different employee', async () => {
      await request(app)
        .post('/tasks/create')
        .set('Authorization', manager.authHeader)
        .send(newTask({ title: `${TEST_PREFIX}private` }));

      const res = await request(app)
        .get('/notifications/getAllNotifications')
        .set('Authorization', other.authHeader);

      expect(res.status).toBe(200);
      const titles = res.body.result.map((n) => n.notification || '');
      expect(titles.some((t) => t.includes(`${TEST_PREFIX}private`))).toBe(false);
    });

    it('does show it to the assignee', async () => {
      await request(app)
        .post('/tasks/create')
        .set('Authorization', manager.authHeader)
        .send(newTask({ title: `${TEST_PREFIX}forme` }));

      const res = await request(app)
        .get('/notifications/getAllNotifications')
        .set('Authorization', worker.authHeader);

      const titles = res.body.result.map((n) => n.notification || '');
      expect(titles.some((t) => t.includes(`${TEST_PREFIX}forme`))).toBe(true);
    });
  });

  describe('reading your own tasks', () => {
    it('returns only the caller\'s tasks, ignoring any id header', async () => {
      await request(app)
        .post('/tasks/create')
        .set('Authorization', manager.authHeader)
        .send(newTask({ title: `${TEST_PREFIX}mine` }));

      // The old route read req.headers.id, so this header used to be enough
      // to read somebody else's task list.
      const res = await request(app)
        .get('/tasks/getAssignedTasks')
        .set('Authorization', other.authHeader)
        .set('id', worker.employee.id);

      expect(res.status).toBe(200);
      const forOther = res.body.result.every(
        (t) => String(t.EmployeeId) === String(other.employee.id)
      );
      expect(forOther).toBe(true);
      expect(res.body.result.some((t) => t.title === `${TEST_PREFIX}mine`)).toBe(false);
    });

    it('blocks a non-manager from the all-tasks oversight view', async () => {
      const res = await request(app)
        .get('/tasks/getAllTasks')
        .set('Authorization', worker.authHeader);
      expect(res.status).toBe(403);
    });
  });

  describe('the dashboard list', () => {
    it('gives an employee their active tasks', async () => {
      const res = await request(app)
        .get('/tasks/dashboard')
        .set('Authorization', worker.authHeader);
      expect(res.status).toBe(200);
      expect(res.body.result.show).toBe(true);
      expect(Array.isArray(res.body.result.tasks)).toBe(true);
    });

    it.each(['CEO', 'CFO', 'admin'])('tells a %s not to show a task list', async (designation) => {
      const boss = await loginAs(designation);
      const res = await request(app)
        .get('/tasks/dashboard')
        .set('Authorization', boss.authHeader);

      // Decided by the API, not the UI, so calling it directly cannot bypass
      // the rule and the rule lives in one place.
      expect(res.status).toBe(200);
      expect(res.body.result.show).toBe(false);
      expect(res.body.result.tasks).toEqual([]);
    });

    it('leaves completed tasks out of the active list', async () => {
      const created = await request(app)
        .post('/tasks/create')
        .set('Authorization', manager.authHeader)
        .send(newTask({ title: `${TEST_PREFIX}done`, status: 'Done' }));

      const res = await request(app)
        .get('/tasks/dashboard')
        .set('Authorization', worker.authHeader);

      expect(res.body.result.tasks.some((t) => t.id === created.body.result.id)).toBe(false);
    });
  });

  describe('changing status', () => {
    let taskId;
    beforeAll(async () => {
      const res = await request(app)
        .post('/tasks/create')
        .set('Authorization', manager.authHeader)
        .send(newTask({ title: `${TEST_PREFIX}status` }));
      taskId = res.body.result.id;
    });

    it('lets the assignee move their own task on', async () => {
      const res = await request(app)
        .post('/tasks/changeTaskStatus')
        .set('Authorization', worker.authHeader)
        .send({ id: taskId, status: 'In-progress' });
      expect(res.status).toBe(200);
    });

    it('blocks an unrelated employee from touching it', async () => {
      const res = await request(app)
        .post('/tasks/changeTaskStatus')
        .set('Authorization', other.authHeader)
        .send({ id: taskId, status: 'Done' });
      expect(res.status).toBe(403);
    });
  });
});
