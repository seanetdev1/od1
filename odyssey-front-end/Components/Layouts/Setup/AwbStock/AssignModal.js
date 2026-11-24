import React, { useMemo, useState } from 'react';
import { Modal, Select, Input, InputNumber, Checkbox, Radio, Spin } from 'antd';
import { Row, Col } from 'react-bootstrap';
import openNotification from 'Components/Shared/Notification';
import { assignAwbs } from 'apis/awbStock';
import { previewSeries } from 'functions/awbNumber';

// Assign registered numbers to a master agent.
//
// Two ways in, because the office works both ways:
//
//   the ticked rows   - a handful picked off the list
//   a run             - "214-10000001, the next fifty", which is how a block
//                       is actually handed over
//
// EITHER WAY THE WHOLE SET IS CHECKED FIRST. The server refuses the batch if
// any number in it already belongs to a different master agent, and names the
// clashes, rather than assigning as far as the first one and stopping. A
// half-assigned run is worse than a refused one: nobody can tell where it got
// to without reading every row.
const AssignModal = ({ open, onClose, onSaved, carriers, masterAgents, selectedIds, employeeId }) => {
  const [mode, setMode] = useState('series');
  const [masterAgentId, setMasterAgentId] = useState(undefined);
  const [carrierId, setCarrierId] = useState(undefined);
  const [code, setCode] = useState('');
  const [series, setSeries] = useState(true);
  const [count, setCount] = useState(10);
  const [saving, setSaving] = useState(false);

  const carrier = (carriers || []).find((c) => c.id === carrierId);
  const prefix = carrier?.prefix || '';
  const ticked = selectedIds || [];

  const reset = () => {
    setMasterAgentId(undefined);
    setCarrierId(undefined);
    setCode('');
    setSeries(true);
    setCount(10);
  };

  const close = () => {
    if (saving) return;
    reset();
    onClose();
  };

  const preview = useMemo(
    () => (mode === 'series' && carrierId ? previewSeries(prefix, code, series, count) : null),
    [mode, carrierId, prefix, code, series, count]
  );

  const submit = async () => {
    if (!masterAgentId) return openNotification('Error', 'Select the master agent.', 'red');
    if (mode === 'selected' && !ticked.length) {
      return openNotification('Error', 'No numbers are ticked in the list.', 'red');
    }
    if (mode === 'series') {
      if (!carrierId) return openNotification('Error', 'Select the carrier the run belongs to.', 'red');
      if (preview?.error) return openNotification('Error', preview.error, 'red');
      if (!preview) return openNotification('Error', 'Enter the number the run starts at.', 'red');
    }

    setSaving(true);
    try {
      const res = await assignAwbs(
        mode === 'selected'
          ? { masterAgentId, ids: ticked, employeeId }
          : { masterAgentId, carrierId, code, series, count, employeeId }
      );
      if (res.status !== 'success') {
        openNotification('Not assigned', res.result || 'Could not assign.', 'red');
        return;
      }
      const { assigned, alreadyTheirs, missing, agent, from, to } = res.result;
      openNotification(
        assigned ? 'Assigned' : 'Nothing to do',
        (assigned
          ? assigned === 1
            ? `${from} assigned to ${agent}.`
            : `${assigned} numbers assigned to ${agent}, ${from} to ${to}.`
          : `Those numbers were already assigned to ${agent}.`) +
          (alreadyTheirs && assigned ? ` ${alreadyTheirs} were already theirs.` : '') +
          // A gap in a block handed over by the airline is exactly the thing
          // worth knowing about, so it is reported rather than skipped.
          (missing?.length
            ? ` ${missing.length} number(s) in that run are not registered yet and were left out: ` +
              `${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`
            : ''),
        missing?.length ? 'orange' : 'green'
      );
      reset();
      onSaved();
      onClose();
    } catch (e) {
      openNotification('Not assigned', e?.response?.data?.result || 'Could not assign.', 'red');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onCancel={close} maskClosable={false} width={660}
      title='Assign AWB numbers to a master agent'
      okText={saving ? 'Saving…' : 'Assign'}
      onOk={submit}
      okButtonProps={{ disabled: saving }} cancelButtonProps={{ disabled: saving }}
    >
      <Spin spinning={saving}>
        <Row className='mb-3'>
          <Col md={12}>
            <div className='mb-1'>Master agent *</div>
            <Select showSearch style={{ width: '100%' }} value={masterAgentId}
              onChange={setMasterAgentId} optionFilterProp='label'
              placeholder='Who are these numbers going to?'
              options={(masterAgents || []).map((a) => ({ value: a.id, label: a.name }))}
            />
            <div className='awb-hint'>
              A number can only ever be with one master agent — assigning it here takes it
              out of stock for everyone else.
            </div>
          </Col>
        </Row>

        <Row className='mb-3'>
          <Col md={12}>
            <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)}>
              <Radio.Button value='series'>A run of numbers</Radio.Button>
              <Radio.Button value='selected'>
                The {ticked.length} ticked in the list
              </Radio.Button>
            </Radio.Group>
          </Col>
        </Row>

        {mode === 'series' ? (
          <>
            <Row className='mb-3'>
              <Col md={8}>
                <div className='mb-1'>Carrier *</div>
                <Select showSearch style={{ width: '100%' }} value={carrierId} onChange={setCarrierId}
                  optionFilterProp='label' placeholder='Whose numbers?'
                  options={(carriers || []).map((c) => ({
                    value: c.id,
                    label: c.prefix ? `${c.prefix} — ${c.name}` : c.name,
                  }))}
                />
              </Col>
              <Col md={4}>
                <div className='mb-1'>AWB prefix</div>
                <Input value={prefix} disabled placeholder='from the carrier' />
              </Col>
            </Row>
            <Row className='mb-2'>
              <Col md={5}>
                <div className='mb-1'>Starts at *</div>
                <Input value={code} maxLength={9} placeholder='10000001'
                  onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))} />
                <div className='awb-hint'>8 digits: serial plus check digit</div>
              </Col>
              <Col md={7}>
                <div className='mb-1'>&nbsp;</div>
                <Checkbox checked={series} onChange={(e) => setSeries(e.target.checked)}>
                  Assign a whole run
                </Checkbox>
                {series && (
                  <div className='mt-2'>
                    <span className='me-2'>How many</span>
                    <InputNumber min={1} max={1000} value={count} style={{ width: 120 }}
                      onChange={(v) => setCount(v || 1)} />
                  </div>
                )}
              </Col>
            </Row>

            {preview?.error && <div className='awb-preview bad'>{preview.error}</div>}
            {preview && !preview.error && (
              <div className='awb-preview good'>
                Checking <b>{preview.total}</b> number{preview.total === 1 ? '' : 's'}:{' '}
                {preview.head.join(', ')}
                {preview.total > preview.head.length && <> … {preview.last}</>}
                <div className='awb-hint mt-1'>
                  The whole run is checked before anything is written. If any of it already
                  belongs to another master agent, nothing is assigned and you are told which.
                </div>
              </div>
            )}
          </>
        ) : (
          <div className='awb-preview good'>
            {ticked.length
              ? <><b>{ticked.length}</b> number{ticked.length === 1 ? '' : 's'} ticked in the list will be assigned.</>
              : 'Nothing is ticked. Close this, tick the numbers you want, and reopen.'}
          </div>
        )}
      </Spin>
    </Modal>
  );
};

export default AssignModal;
