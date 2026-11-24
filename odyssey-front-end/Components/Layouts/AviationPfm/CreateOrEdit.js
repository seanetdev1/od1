import React, { useEffect, useState } from 'react';
import { Input, DatePicker, Select, Spin, Tag, Alert } from 'antd';
import { Row, Col } from 'react-bootstrap';
import Router from 'next/router';
import Cookies from 'js-cookie';
import { useDispatch } from 'react-redux';
import { incrementTab } from 'redux/tabs/tabSlice';
import moment from 'moment';
import Lines, { blankLine } from './Lines';
import openNotification from 'Components/Shared/Notification';
import { getAviationValues } from 'apis/aviationJobs';
import { getAvailableAwbs } from 'apis/awbStock';
import { getPfmById, createPfm, editPfm, cancelPfm } from 'apis/aviationPfm';
import { usePageActions } from 'Components/Shared/PageActions';
import {
  PFM_STATUSES, DRAFT, CONFIRMED, CANCELLED, statusOf, statusColor, flownAs,
} from 'functions/aviationPfmStatus';

// Create / edit one PFM - the pre-flight manifest a flight is built from.
//
// SHAPED LIKE THE FLIGHT FORM ON PURPOSE. Plain useState, a header of flat
// fields, a grid underneath, Save and Cancel in the toolbar. The two documents
// are entered by the same people minutes apart, and a plan that behaved
// differently from the flight it becomes would be a second thing to learn for
// no reason. What differs is what a plan IS - see the header comments on the
// model and the router.
//
// TWO STATES GOVERN EVERYTHING ON THIS SCREEN:
//
//   cancelled  the plan was abandoned. Read-only, as a cancelled flight is.
//   FLOWN      a flight has been built from it. ALSO read-only, and this one
//              is particular to a plan: the flight quotes this plan's number,
//              date and airline, so letting the plan change afterwards would
//              leave two documents disagreeing with nothing to reconcile them.
//              The server refuses it too - this is the screen saying so first
//              rather than the only thing saying it.
const emptyPfm = {
  flightNo: '',
  // The operating airline - whose flight this is. Same aliased column the
  // flight carries, which is what makes the import a copy rather than a
  // translation.
  operatingCarrierId: null,
  AviationAircraftId: null,
  origin: '',
  // NO DESTINATION on the header. One departure serves many destinations -
  // that is what a consolidated flight is - so it lives on each line. See the
  // model.
  flightDate: '',
  status: DRAFT,
  remarks: '',
};

// antd here is v4, whose pickers take MOMENT objects. Stored as a plain string
// in the shape the rest of the app writes dates, shown DD-MM-YYYY to match
// Components/Shared/Form/DateComp - identical to the flight form.
const D_STORE = 'YYYY-MM-DD';
const D_SHOW = 'DD-MM-YYYY';

/* What a plan must carry before it can be saved.
 *
 * Four fields, and they are exactly the four the flight will inherit and then
 * require for itself (see REQUIRED_FLIGHT_FIELDS in aviationValidation). A
 * plan allowed to save without them would build a flight that cannot be
 * saved at all - the failure would surface two screens away from its cause. */
const REQUIRED = [
  ['flightNo', 'Flight No.'],
  ['operatingCarrierId', 'Airline'],
  ['origin', 'Origin'],
  ['flightDate', 'Flight Date'],
];

const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';

const linesFrom = (r) => (r?.Aviation_Pfm_Lines?.length
  ? r.Aviation_Pfm_Lines.map((l) => ({ ...blankLine, ...l }))
  : [{ ...blankLine }]);

const CreateOrEdit = ({ id, companyId }) => {
  const dispatchTab = useDispatch();
  // Treat a missing/garbage id as a new plan rather than trying to load it. A
  // tab registered without an id used to put the literal string "undefined" in
  // the URL, which then reached /edit as the row to update.
  const isNew = !id || id === 'new' || id === 'undefined' || id === 'null';

  const [pfm, setPfm] = useState(emptyPfm);
  const [lines, setLines] = useState([{ ...blankLine }]);
  const [values, setValues] = useState({
    party: [], masterAgent: [], commodity: [], airport: [], carrier: [], aircraft: [], awb: [],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pfmNo, setPfmNo] = useState('');
  // The flight built from this plan, as a job number - null while it is still
  // just a plan. Its presence is what freezes the screen.
  const [flown, setFlown] = useState(null);
  const [flownJobId, setFlownJobId] = useState(null);

  const set = (field, value) => setPfm((p) => ({ ...p, [field]: value }));

  const cancelled = statusOf(pfm) === CANCELLED;
  // ONE flag for "nothing on this screen may be changed", so a control cannot
  // be given one reason and forget the other.
  const locked = cancelled || Boolean(flown);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [v, existing, stock] = await Promise.all([
          // The SAME pick lists the flight screen reads. A plan and the flight
          // built from it must choose from identical masters, or the import
          // would hand the flight an id its own dropdown does not contain.
          getAviationValues(),
          getPfmById({ id: isNew ? 'new' : id }),
          // Never fatal to opening a plan: if the register cannot be read, the
          // AWB cell is simply empty rather than the whole screen refusing to
          // load over a Setup list.
          getAvailableAwbs().catch(() => ({ status: 'error', result: [] })),
        ]);
        if (!alive) return;
        if (v?.status === 'success') {
          setValues({ ...v.result, awb: stock?.status === 'success' ? stock.result : [] });
        }
        if (existing?.result) {
          const r = existing.result;
          setPfmNo(r.pfmNo || '');
          setFlown(flownAs(r));
          setFlownJobId(r.Aviation_Job?.id ?? null);
          setPfm({ ...emptyPfm, ...pickHeader(r) });
          setLines(linesFrom(r));
        }
      } catch (e) {
        openNotification('Error', e?.response?.data?.result || 'Could not load this PFM.', 'red');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id]);

  /* Everything wrong reported AT ONCE, rather than stopping at the first
   * problem - the same rule the flight form follows, and for the same reason:
   * a form checked one field per attempt is how someone ends up pressing Save
   * eight times. */
  const problemsWith = () => {
    const problems = [];
    const missing = REQUIRED.filter(([f]) => isBlank(pfm[f])).map(([, label]) => label);
    if (missing.length) problems.push(`PFM Info — ${missing.join(', ')}`);

    /* A CONFIRMED PLAN MUST HAVE SOMETHING ON IT. Confirming is the act that
     * offers this plan to the flight screen, and a flight built from an empty
     * plan arrives with one blank consignment row and a PFM weight of nought -
     * which looks exactly like a flight somebody forgot to fill in. A draft
     * with no lines is fine; that is what a draft is for. */
    if (statusOf(pfm) === CONFIRMED && !lines.some(isRealPlannedLine)) {
      problems.push('Consignments — a confirmed PFM must plan at least one consignment');
    }
    return problems;
  };

  const save = async () => {
    const problems = problemsWith();
    if (problems.length) {
      openNotification('This PFM cannot be saved yet', problems.join(' · '), 'red');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...pfm,
        id: isNew ? undefined : id,
        companyId: `${companyId ?? ''}`,
        fiscalYearId: Cookies.get('fiscalYearId'),
        lines,
      };
      const employeeId = Cookies.get('loginId');
      const res = isNew
        ? await createPfm(payload, employeeId)
        : await editPfm(payload, employeeId);

      if (res.status !== 'success') {
        openNotification('Error', res.result || 'Could not save this PFM.', 'red');
        return;
      }
      openNotification('Success', `PFM ${res.result.pfmNo} saved.`, 'green');
      if (isNew) {
        // Re-point the tab at the saved plan. It was opened as id:'new', and
        // MainLayout builds this key's URL from tab.id - leaving it would send
        // the next click on that tab back to /aviationPfm/new.
        dispatchTab(incrementTab({ label: res.result.pfmNo, key: '10-4', id: res.result.id }));
        Router.push(`/aviationPfm/${res.result.id}`);
        return;
      }
      setPfmNo(res.result.pfmNo || '');
      setLines(linesFrom(res.result));
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || 'Could not save this PFM.', 'red');
    } finally {
      setSaving(false);
    }
  };

  const cancel = async () => {
    try {
      const res = await cancelPfm(id, Cookies.get('loginId'));
      if (res.status !== 'success') {
        openNotification('Error', res.result || 'Could not cancel this PFM.', 'red');
        return;
      }
      openNotification('Success', 'PFM cancelled.', 'green');
      Router.push('/aviationPfm/list');
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || 'Could not cancel.', 'red');
    }
  };

  /* A master registered from the grid, dropped into the lists this screen is
   * already holding rather than re-fetched wholesale - and labelled EXACTLY as
   * /getValues labels it, because that is what the row will show after the
   * next reload. Identical to the flight screen's addMaster, deliberately:
   * a commodity registered from a plan and one registered from a flight must
   * read the same in both dropdowns.
   *
   * An AWB is the exception and is re-read rather than built here. A stock row
   * carries the serial and check digit the line writes onto itself, and a
   * half-built one would produce a number that could be picked but not
   * spelled. */
  const addMaster = React.useCallback(async (kind, row, party) => {
    if (kind === 'awb') {
      const stock = await getAvailableAwbs().catch(() => null);
      if (stock?.status === 'success') setValues((v) => ({ ...v, awb: stock.result }));
      return;
    }
    if (!row?.id) return;
    setValues((v) => {
      if (kind === 'commodity') {
        const option = { id: row.id, name: row.hs ? `${row.name} (${row.hs})` : row.name };
        return { ...v, commodity: [...(v.commodity || []), option] };
      }
      if (kind === 'masterAgent') {
        const option = { id: row.id, name: `${row.name} (${row.code})` };
        return {
          ...v,
          masterAgent: [...(v.masterAgent || []), option],
          party: [...(v.party || []), option],
        };
      }
      if (kind === 'airport') {
        // `id` IS the airport CODE - a destination is stored as the code, not
        // as a foreign key, the same shape the consignments and the freight
        // air jobs use. The header's Origin reads this same list.
        const option = {
          id: row.airportCode,
          name: `${row.airportName} (${row.airportCode})`,
          city: row.city,
        };
        return { ...v, airport: [...(v.airport || []), option] };
      }
      if (kind === 'carrier') {
        const carrier = {
          id: row.id, name: row.name, prefix: row.prefix,
          category: row.category, partyId: row.partyId ?? null,
        };
        const known = party?.id && (v.party || []).some((p) => p.id === party.id);
        return {
          ...v,
          carrier: [...(v.carrier || []), carrier],
          party: party?.id && !known
            ? [...(v.party || []), { id: party.id, name: `${party.name} (${party.code})` }]
            : v.party,
        };
      }
      return v;
    });
  }, []);

  /* ABOVE THE LOADING GUARD, and it has to be: this screen returns a spinner
   * while it fetches, and a hook below that return runs on the renders that
   * get past it and not on the ones that do not. See PageActions. */
  usePageActions({
    title: isNew ? 'New PFM' : `PFM ${pfmNo}`,
    subtitle: flown ? `Flown as ${flown}` : (cancelled ? 'Cancelled' : undefined),
    save: {
      onClick: save,
      busy: saving,
      disabled: locked || loading,
      label: 'Save PFM',
      title: flown
        ? `Already flown as ${flown} — correct the flight instead`
        : (cancelled ? 'A cancelled PFM cannot be edited' : 'Save this PFM'),
    },
    delete: isNew ? undefined : {
      onClick: cancel,
      disabled: locked,
      label: 'Cancel PFM',
      confirm: 'Cancel this PFM? Its number stays on record and it will no longer be offered to a flight.',
      title: flown
        ? `Already flown as ${flown} — cancel the flight instead`
        : (cancelled ? 'This PFM is already cancelled' : 'Cancel this PFM'),
    },
    // The flight this plan became, where the flight screen has View PFM
    // pointing back. One click each way, so neither document is a dead end.
    extras: flownJobId ? [{
      key: 'viewFlight',
      // The flight's document code, matching how the flight screen names this
      // plan - so the two buttons that point at each other are read the same
      // way from either side. See PageActions.
      glyph: 'AVJ',
      label: `View ${flown}`,
      title: `Open the flight built from this PFM`,
      onClick: () => {
        dispatchTab(incrementTab({ label: flown, key: '10-2', id: flownJobId }));
        Router.push(`/aviationJobs/${flownJobId}`);
      },
    }] : undefined,
  }, [saving, locked, isNew, pfmNo, loading, flown, flownJobId]);

  if (loading) return <div className='base-page-layout'><Spin /> Loading…</div>;

  const asMoment = (v) => {
    if (!v) return null;
    const m = moment(v, D_STORE, true);
    return m.isValid() ? m : null;
  };

  return (
    <div className='client-styles aviation-pfm' style={{ overflowY: 'auto', overflowX: 'hidden' }}>
      {/* WHY THE SCREEN IS READ-ONLY, said at the top rather than left to be
          inferred from a page of greyed boxes. A form that will not accept
          typing and does not say why is the support call this banner is. */}
      {flown && (
        <Alert
          type='info' showIcon className='mb-3'
          message={`This PFM has been flown as ${flown}.`}
          description={
            'A plan is fixed once a flight is built from it — the flight quotes this '
            + 'number, date and airline. Anything that needs correcting now belongs on the flight.'
          }
        />
      )}
      {cancelled && !flown && (
        <Alert
          type='warning' showIcon className='mb-3'
          message='This PFM has been cancelled.'
          description='Its number stays on record, and it is no longer offered to a flight.'
        />
      )}

      <Row>
        <Col md={3} className='mt-2'>
          <div>Flight No. *</div>
          {/* TYPED HERE AND NOWHERE ELSE. This is the one place in the aviation
              module where a flight number is entered by hand - the flight
              screen picks a PFM instead of accepting one, so this box is where
              every flight number in the system now originates. */}
          <Input value={pfm.flightNo || ''} disabled={locked}
            placeholder='e.g. PK-301'
            onChange={(e) => set('flightNo', e.target.value)} />
        </Col>
        <Col md={3} className='mt-2'>
          <div title='The airline operating this flight — not who each AWB belongs to'>
            Airline *
          </div>
          {/* Registered in Setup > Carriers, the same master the lines pick
              from - but answering a different question. This is whose flight
              it is; the Carrier column below is whose cargo each AWB is, and a
              flight routinely carries other carriers' loads. */}
          <Select showSearch allowClear style={{ width: '100%' }} optionFilterProp='label'
            placeholder='Whose flight is this?'
            value={pfm.operatingCarrierId ?? undefined}
            disabled={locked}
            onChange={(v) => set('operatingCarrierId', v ?? null)}
            options={(values.carrier || []).map((c) => ({ value: c.id, label: c.name }))} />
        </Col>
        <Col md={3} className='mt-2'>
          <div>Aircraft</div>
          <Select showSearch allowClear style={{ width: '100%' }} optionFilterProp='label'
            placeholder='Aircraft'
            value={pfm.AviationAircraftId ?? undefined}
            disabled={locked}
            onChange={(v) => set('AviationAircraftId', v ?? null)}
            options={(values.aircraft || []).map((a) => ({
              value: a.id,
              label: a.description ? `${a.name} — ${a.description}` : a.name,
            }))} />
        </Col>
        <Col md={3} className='mt-2'>
          <div>Status</div>
          {/* DRAFT / CONFIRMED / CANCELLED - the life of a plan. Only a
              CONFIRMED plan is offered to the flight screen, which is the
              whole working significance of this box; the hint under it says so
              rather than leaving somebody to wonder why the PFM they raised
              this morning is not in the flight's dropdown. */}
          <Select style={{ width: '100%' }} value={statusOf(pfm)} disabled={locked}
            onChange={(v) => set('status', v)}
            options={PFM_STATUSES.map((s) => ({ value: s, label: s }))} />
          <div className='status-hint'>
            {statusOf(pfm) === CONFIRMED
              ? <span className='ok'>Offered to the flight screen until it is flown or its date passes.</span>
              : statusOf(pfm) === CANCELLED
                ? <span className='off'>Never offered to a flight.</span>
                : <span className='off'>A draft is not offered to a flight — confirm it first.</span>}
          </div>
        </Col>

        <Col md={3} className='mt-2'>
          <div>Origin *</div>
          {/* The stored value is the airport CODE, so a plan saved before its
              airport reached the master list still shows that code rather than
              blanking - Select keeps an unmatched value visible. */}
          <Select showSearch allowClear style={{ width: '100%' }} optionFilterProp='label'
            placeholder='Origin'
            value={pfm.origin || undefined}
            disabled={locked}
            onChange={(v) => set('origin', v ?? '')}
            options={(values.airport || []).map((a) => ({ value: a.id, label: a.name }))} />
        </Col>
        <Col md={3} className='mt-2'>
          <div>Flight Date *</div>
          <DatePicker
            value={asMoment(pfm.flightDate)}
            onChange={(d) => set('flightDate', d && d.isValid() ? d.format(D_STORE) : '')}
            format={D_SHOW} style={{ width: '100%' }} disabled={locked} />
          {/* A plan whose date has gone by is not offered to a flight, and the
              dropdown cannot explain its own omissions - so it is said here,
              where the date is. */}
          {pfm.flightDate && pfm.flightDate < moment().format(D_STORE) && !flown && (
            <div className='status-hint'><span className='off'>
              This date has passed, so the PFM is no longer offered to a flight.
            </span></div>
          )}
        </Col>
        <Col md={6} className='mt-2'>
          <div>Remarks</div>
          {/* Copied onto the flight only when the flight has none - an import
              fills a gap and never replaces what someone typed. See
              functions/aviationPfmImport. */}
          <Input.TextArea rows={1} value={pfm.remarks || ''} disabled={locked}
            onChange={(e) => set('remarks', e.target.value)} />
        </Col>
      </Row>

      <div className='lines-head mt-4'>
        <b>Planned Consignments</b>
        <Tag color={statusColor(statusOf(pfm))}>{statusOf(pfm)}</Tag>
        <span className='grey-txt'>
          Pieces and weights here are the plan. The flight takes everything else from this
          list; its weights are entered from what is actually weighed.
        </span>
      </div>

      <Lines lines={lines} setLines={setLines} values={values}
        disabled={locked} onRegister={addMaster} />

      <style jsx global>{`
        .aviation-pfm .status-hint { font-size: 10.5px; line-height: 1.4; margin-top: 3px; }
        .aviation-pfm .status-hint .ok { color: #237804; }
        .aviation-pfm .status-hint .off { color: #8a97a3; }
        .aviation-pfm .lines-head {
          display: flex;
          align-items: baseline;
          gap: 8px;
          border-top: 1px solid #e9edf2;
          padding-top: 10px;
        }
        .aviation-pfm .lines-head .grey-txt { font-size: 11px; color: #8a97a3; }
      `}</style>
    </div>
  );
};

/**
 * A planned line worth counting.
 *
 * MIRRORS isRealLine in the PFM router - anything else is an "Add Consignment
 * +" the user thought better of, which the server drops rather than saving.
 * Counting those would let an empty plan be confirmed on the strength of a row
 * that was never going to be stored.
 */
export const isRealPlannedLine = (x) =>
  Boolean(x && (x.AviationCarrierId || x.masterAgentId || x.AviationAwbId ||
    String(x.awb || '').trim() || String(x.destination || '').trim()));

// Only the header fields belong in form state - the row also carries id,
// pfmNo, timestamps, its lines and its flight, none of which the inputs own.
const pickHeader = (r) => Object.fromEntries(
  Object.keys(emptyPfm).map((k) => [k, r[k] ?? emptyPfm[k]])
);

export default CreateOrEdit;
