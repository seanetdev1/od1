import React, { useMemo, useState } from 'react';
import { Modal, Select, Input, InputNumber, Checkbox, Spin } from 'antd';
import { Row, Col } from 'react-bootstrap';
import openNotification from 'Components/Shared/Notification';
import { registerAwbs } from 'apis/awbStock';
import { previewSeries } from 'functions/awbNumber';

// Register AWB numbers against a carrier.
//
// The PREFIX IS NOT TYPED. It belongs to the carrier - it is unique to one,
// and an AWB is prefix + serial - so it is read off the carrier record and
// shown, not entered. Typing it here is how one carrier ends up with two
// prefixes and a number that belongs to nobody.
//
// Only the 8 digits printed on the document are entered: the 7-digit serial
// and its check digit. The check digit is VERIFIED rather than assumed,
// because it is the one part of the number that can be derived - a mismatch
// means a typo, and a mistyped number is one no airline will accept.
const RegisterModal = ({ open, onClose, onSaved, carriers, employeeId }) => {
  const [carrierId, setCarrierId] = useState(undefined);
  const [code, setCode] = useState('');
  const [series, setSeries] = useState(false);
  const [count, setCount] = useState(10);
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);

  const carrier = (carriers || []).find((c) => c.id === carrierId);
  const prefix = carrier?.prefix || '';

  const reset = () => {
    setCarrierId(undefined);
    setCode('');
    setSeries(false);
    setCount(10);
    setRemarks('');
  };

  const close = () => {
    if (saving) return;
    reset();
    onClose();
  };

  // Live preview, computed by the same rule the server stores by. Showing the
  // first few AND the last one removes any doubt about how far a series of 200
  // actually reaches before it is committed.
  const preview = useMemo(
    () => (carrierId ? previewSeries(prefix, code, series, count) : null),
    [carrierId, prefix, code, series, count]
  );

  const submit = async () => {
    if (!carrierId) return openNotification('Error', 'Select the carrier these numbers belong to.', 'red');
    if (preview?.error) return openNotification('Error', preview.error, 'red');

    setSaving(true);
    try {
      const res = await registerAwbs({ carrierId, code, series, count, remarks, employeeId });
      if (res.status !== 'success') {
        openNotification('Not registered', res.result || 'Could not register.', 'red');
        return;
      }
      const { created, skipped, voided, voidedNote, from, to } = res.result;
      openNotification(
        'Registered',
        (created === 1 ? `${from} added.` : `${created} numbers added, ${from} to ${to}.`) +
          (skipped ? ` ${skipped} were already registered and were skipped.` : '') +
          // A number skipped because it is VOIDED looks identical to one
          // skipped because it was already there, and the two mean very
          // different things to whoever is counting the block in from the
          // airline. So it is called out rather than folded into `skipped`.
          (voidedNote ? ` ${voidedNote}` : ''),
        voided ? 'orange' : 'green'
      );
      reset();
      onSaved();
      onClose();
    } catch (e) {
      openNotification('Not registered', e?.response?.data?.result || 'Could not register.', 'red');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onCancel={close} maskClosable={false} width={660}
      title='Register AWB numbers'
      okText={saving ? 'Saving…' : 'Register'}
      onOk={submit}
      okButtonProps={{ disabled: saving }} cancelButtonProps={{ disabled: saving }}
    >
      <Spin spinning={saving}>
        <Row className='mb-3'>
          <Col md={8}>
            <div className='mb-1'>Carrier *</div>
            <Select showSearch style={{ width: '100%' }} value={carrierId} onChange={setCarrierId}
              placeholder='Which airline issued these numbers?'
              optionFilterProp='label'
              options={(carriers || []).map((c) => ({
                value: c.id,
                label: c.prefix ? `${c.prefix} — ${c.name}` : c.name,
              }))}
            />
          </Col>
          <Col md={4}>
            <div className='mb-1'>AWB prefix</div>
            {/* Read-only on purpose - see the note at the top of this file. */}
            <Input value={prefix} disabled placeholder='from the carrier' />
            {carrierId && !prefix && (
              <div className='awb-warn'>
                This carrier has no prefix. Set it in Setup &gt; Carriers first.
              </div>
            )}
          </Col>
        </Row>

        <Row className='mb-3'>
          <Col md={5}>
            <div className='mb-1'>AWB number *</div>
            <Input value={code} maxLength={9} placeholder='10000001'
              onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))} />
            <div className='awb-hint'>8 digits: the 7-digit serial plus its check digit</div>
          </Col>
          <Col md={7}>
            <div className='mb-1'>&nbsp;</div>
            <Checkbox checked={series} onChange={(e) => setSeries(e.target.checked)}>
              Generate a series from this number
            </Checkbox>
            {series && (
              <div className='mt-2'>
                <span className='me-2'>How many</span>
                <InputNumber min={1} max={1000} value={count} style={{ width: 120 }}
                  onChange={(v) => setCount(v || 1)} />
                <div className='awb-hint'>
                  Counts the serial forward and recalculates each check digit
                </div>
              </div>
            )}
          </Col>
        </Row>

        <Row className='mb-2'>
          <Col md={12}>
            <div className='mb-1'>Remarks</div>
            <Input value={remarks} placeholder='e.g. block received 12-08-2026'
              onChange={(e) => setRemarks(e.target.value)} />
          </Col>
        </Row>

        {preview?.error && <div className='awb-preview bad'>{preview.error}</div>}
        {preview && !preview.error && (
          <div className='awb-preview good'>
            <b>{preview.total}</b> number{preview.total === 1 ? '' : 's'} will be registered:{' '}
            {preview.head.join(', ')}
            {preview.total > preview.head.length && <> … {preview.last}</>}
            {preview.truncated && (
              <div className='mt-1' style={{ color: '#ad6800' }}>
                Stops at the highest 7-digit serial — the series does not roll over.
              </div>
            )}
            <div className='awb-hint mt-1'>
              Numbers already in the register are skipped, so re-running a series to fill a
              gap is safe.
            </div>
          </div>
        )}

        <style jsx global>{`
          .awb-hint { font-size: 11px; color: #8a97a3; margin-top: 2px; }
          .awb-warn { font-size: 11px; color: #ad6800; margin-top: 2px; }
          .awb-preview {
            margin-top: 14px;
            padding: 8px 10px;
            font-size: 12px;
            border-radius: 4px;
          }
          .awb-preview.good { background: #f6ffed; border: 1px solid #b7eb8f; }
          .awb-preview.bad  { background: #fff1f0; border: 1px solid #ffa39e; }
        `}</style>
      </Spin>
    </Modal>
  );
};

export default RegisterModal;
