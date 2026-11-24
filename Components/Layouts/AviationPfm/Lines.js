import React from 'react';
import { Table } from 'react-bootstrap';
import { Select, Input, InputNumber } from 'antd';
import { CloseCircleOutlined, PlusCircleOutlined } from '@ant-design/icons';
import PopConfirm from 'Components/Shared/PopConfirm';
// Registering a master without leaving the plan. The SAME modals the flight's
// consignment grid opens - a carrier registered from a PFM and one registered
// from a flight must be the same record created the same way, and two short
// forms would eventually disagree about what a carrier needs.
import {
  CommodityModal, PartyModal, AwbModal, CarrierModal, AirportModal,
} from 'Components/Layouts/AviationJobs/QuickRegister';
import { formatNumber, digitsOnly } from 'functions/awbNumber';

// The planned consignments on a PFM.
//
// A DELIBERATELY SHORTER version of the flight's consignment grid. That one
// has twenty-odd columns because it has to price and invoice each AWB; this
// has eleven, because a plan only answers: whose cargo, on which air waybill,
// for which agent, going where, what is it, who flies it onward, roughly how
// much, and how is it to be loaded.
//
// It is NOT a copy of Consignments.js with columns commented out. Everything
// that grid does which a plan has no use for - offload arithmetic, chargeable
// weight drivers, per-side rate locks, fortnight windows, invoice freezes,
// continuation-leg prefill - is absent rather than disabled, because every one
// of those behaviours exists to protect a figure that gets billed, and nothing
// here gets billed.
//
// THE TWO COLUMNS THE FLIGHT HAS NOT: SL-Carrier and SL-Flight, the onward
// carriage this cargo is booked onto after it lands. They stay on the plan -
// the import does not carry them to the flight, and the flight's View PFM
// button is how they are read back. See functions/aviationPfmImport.
export const blankLine = {
  AviationCarrierId: null,
  // The register row this planned AWB was taken out of, and the 8 digits
  // printed on it. Both, exactly as a consignment carries both, so the import
  // can hand the flight a number that is still tied to Setup > AWB Stock.
  AviationAwbId: null,
  awb: '',
  masterAgentId: null,
  destination: '',
  CommodityId: null,
  // Who carries it onward, and on what. slFlightNo is free text: it is another
  // airline's flight number, off their schedule, and there is nothing here for
  // it to be picked from.
  slCarrierId: null,
  slFlightNo: '',
  // PLANNED figures - what the agent says is coming. Not carried onto the
  // flight; only their chargeable TOTAL is. See functions/aviationPfmImport.
  pieces: null,
  grossWeight: null,
  chargeableWeight: null,
  loadPlan: '',
};

// A legacy or hand-entered number is kept selectable as itself rather than
// blanked. Prefixed so it can never collide with a stock row's numeric id -
// the same escape, and the same prefix, the flight's grid uses.
const TYPED = 't:';

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

const Lines = ({ lines, setLines, values, disabled, onRegister }) => {
  /* The headings that register their master, exactly as the flight's grid does
   * it: on the heading rather than beside every dropdown, because the answer
   * is the same for the whole column and twenty plus-signs down a grid is
   * noise. Five of them, and between them that is every picked field a plan
   * needs - so a whole plan can be built without leaving it. */
  const [registering, setRegistering] = React.useState('');

  const setFields = (i, patch) => {
    setLines((current) => current.map((x, n) => (n === i ? { ...x, ...patch } : x)));
  };
  const set = (i, field, value) => setFields(i, { [field]: value });

  const addLine = () => setLines((current) => [...current, { ...blankLine }]);

  const removeLine = (i) => {
    // A row with nothing in it goes without asking - there is nothing to lose,
    // and a confirmation over a blank row is a dialog that teaches people to
    // click through dialogs.
    const line = lines[i];
    const empty = !line.AviationCarrierId && !line.awb && !line.masterAgentId
      && !line.destination && !line.CommodityId;
    const drop = () => setLines((current) => (current.length === 1
      ? [{ ...blankLine }]
      : current.filter((_, n) => n !== i)));
    if (empty) { drop(); return; }
    PopConfirm('Confirmation', 'Remove this planned consignment?', drop);
  };

  /* ------------------------------ the AWB ------------------------------
   * PICKED from Setup > AWB Stock, not typed - and this is the decision that
   * makes the whole import worth having.
   *
   * A planned line carries the register row's id, so the consignment built
   * from it arrives on the flight already tied to the register. Had the plan
   * taken a typed number instead, every imported AWB would reach the flight
   * looking like a number somebody invented, the stock would never be claimed
   * for a real flight, and the Setup > AWB Stock screen would quietly stop
   * meaning anything.
   *
   * The two directions work as one, as they do on the flight:
   *   pick the master agent first  -> the list narrows to that agent's numbers
   *   pick the number first        -> the agent and carrier it belongs to fill in
   *
   * NO PENDING-LOAD PREFILL. The flight's grid carries an offloaded AWB's
   * details forward onto its next leg; a plan has no offloads and no earlier
   * leg to read, so there is nothing to carry.
   * ------------------------------------------------------------------- */
  const stock = values.awb || [];
  const stockById = React.useMemo(() => {
    const m = new Map();
    for (const s of stock) m.set(s.id, s);
    return m;
  }, [stock]);

  const awbOptionsFor = (line) => {
    const list = stock.filter((s) => {
      if (s.id === line.AviationAwbId) return true;   // never hide the current one
      // A number already given to someone else is not this line's to plan on.
      if (line.masterAgentId && s.masterAgentId !== line.masterAgentId) return false;
      if (line.AviationCarrierId && s.AviationCarrierId !== line.AviationCarrierId) return false;
      return true;
    });

    const options = list.map((s) => ({
      value: String(s.id),
      label: formatNumber(s.awbNumber),
      // Searching by digits, so 21410000001 and 214-10000001 both find it.
      search: digitsOnly(s.awbNumber),
    }));

    // A saved line whose number has since left the available list - it flew on
    // some other flight, or was given to an agent - must still show on its own
    // row, or opening an old plan would blank the AWB and saving would wipe it.
    if (line.AviationAwbId && !list.some((s) => s.id === line.AviationAwbId)) {
      const own = line.Aviation_Awb;
      options.unshift({
        value: String(line.AviationAwbId),
        label: own?.awbNumber ? formatNumber(own.awbNumber) : (line.awb || ''),
        search: digitsOnly(own?.awbNumber || line.awb),
      });
    }

    // A number recorded before the register held it keeps showing as itself.
    if (!line.AviationAwbId && line.awb) {
      options.unshift({
        value: `${TYPED}${line.awb}`,
        label: line.awb,
        search: digitsOnly(line.awb),
      });
    }
    return options;
  };

  const pickAwb = (i, line, key) => {
    if (!key) { setFields(i, { AviationAwbId: null, awb: '' }); return; }
    if (String(key).startsWith(TYPED)) return;   // re-picking its own legacy value

    const s = stockById.get(Number(key));
    if (!s) return;
    setFields(i, {
      AviationAwbId: s.id,
      // The 8 digits printed on the document - serial plus check digit. The
      // 3-digit prefix is not stored per line: it belongs to the carrier,
      // which the Prefix column reads it from.
      awb: `${s.serial}${s.checkDigit}`,
      // A number names its carrier, so picking one settles that too...
      AviationCarrierId: s.AviationCarrierId ?? line.AviationCarrierId,
      // ...and the agent it was given out to, which is the other direction.
      masterAgentId: s.masterAgentId ?? line.masterAgentId,
    });
  };

  const carrierOf = (line) =>
    (values.carrier || []).find((c) => c.id === line.AviationCarrierId);
  const prefixOf = (line) => carrierOf(line)?.prefix || '';

  const options = (list) => (list || []).map((x) => ({ value: x.id, label: x.name }));
  const carrierOptions = React.useMemo(() => options(values.carrier), [values.carrier]);
  const agentOptions = React.useMemo(() => options(values.masterAgent), [values.masterAgent]);
  const commodityOptions = React.useMemo(() => options(values.commodity), [values.commodity]);
  const airportOptions = React.useMemo(() => options(values.airport), [values.airport]);

  // Totals of what is PLANNED. Derived, never typed - the only figure that
  // leaves this screen is the chargeable total, and it lands in the flight's
  // PFM field, so it must be a total of the rows it claims to summarise.
  const totals = React.useMemo(() => lines.reduce((t, l) => ({
    pieces: t.pieces + num(l.pieces),
    grossWeight: t.grossWeight + num(l.grossWeight),
    chargeableWeight: t.chargeableWeight + num(l.chargeableWeight),
  }), { pieces: 0, grossWeight: 0, chargeableWeight: 0 }), [lines]);

  const fmt = (n) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const numberCell = (i, field, value, extra = {}) => (
    <InputNumber
      controls={false}
      size='small'
      style={{ width: '100%' }}
      placeholder='0'
      value={value}
      disabled={disabled}
      onChange={(v) => set(i, field, v)}
      {...extra}
    />
  );

  return (
    <>
      <CommodityModal open={registering === 'commodity'} onClose={() => setRegistering('')}
        onCreated={(row) => onRegister?.('commodity', row)} />
      <PartyModal open={registering === 'masterAgent'} onClose={() => setRegistering('')}
        type='Master Agent'
        onCreated={(row) => onRegister?.('masterAgent', row)} />
      {/* No row is handed back for an AWB, deliberately: the host re-reads the
          register instead. A stock row carries the serial and check digit the
          line writes onto itself, and half-building one here would produce a
          number that could be picked but not spelled. Same contract as the
          flight's grid. */}
      <AwbModal open={registering === 'awb'} onClose={() => setRegistering('')}
        carriers={values.carrier || []} masterAgents={values.masterAgent || []}
        onCreated={() => onRegister?.('awb')} />
      <CarrierModal open={registering === 'carrier'} onClose={() => setRegistering('')}
        parties={values.party || []}
        onCreated={(row, party) => onRegister?.('carrier', row, party)} />
      <AirportModal open={registering === 'airport'} onClose={() => setRegistering('')}
        airports={values.airport || []}
        onCreated={(row) => onRegister?.('airport', row)} />

      <div style={{ overflowX: 'auto' }} className='pfm-lines'>
        <Table className='mt-2'>
          <thead>
            <tr style={{ whiteSpace: 'nowrap' }}>
              <th>#</th>
              {/* FIVE HEADINGS REGISTER THEIR MASTER - the same five the
                  flight's grid offers, for the same reason: between them they
                  are every picked field a line needs, so a plan can be built
                  without leaving it half-typed while somebody goes to Setup. */}
              <th className='col-quick'
                onClick={() => !disabled && setRegistering('carrier')}
                title='Register a carrier without leaving this PFM'>
                Carrier <PlusCircleOutlined className='quick-add' />
              </th>
              <th>Prefix</th>
              <th className='col-quick'
                onClick={() => !disabled && setRegistering('awb')}
                title='Register an AWB number without leaving this PFM'>
                AWB # <PlusCircleOutlined className='quick-add' />
              </th>
              <th className='col-quick'
                onClick={() => !disabled && setRegistering('masterAgent')}
                title='Register a master agent without leaving this PFM'>
                Master Agent <PlusCircleOutlined className='quick-add' />
              </th>
              <th className='col-quick'
                onClick={() => !disabled && setRegistering('airport')}
                title='Register an airport without leaving this PFM'>
                Destination <PlusCircleOutlined className='quick-add' />
              </th>
              <th className='col-quick'
                onClick={() => !disabled && setRegistering('commodity')}
                title='Register a commodity without leaving this PFM'>
                Commodity <PlusCircleOutlined className='quick-add' />
              </th>
              {/* The onward carriage, kept together and marked as one group:
                  read apart, "Carrier" and "SL-Carrier" are two columns of
                  airline names with nothing saying which is which. */}
              <th className='col-sl' title='Second leg — who carries this cargo onward'>
                SL-Carrier
              </th>
              <th className='col-sl' title="Second leg — the onward carrier's flight number">
                SL-Flight
              </th>
              {/* PLANNED. The heading says so, because these three are the
                  figures the flight will NOT inherit - what the agent expects,
                  not what anyone has weighed. */}
              <th className='col-planned'>Pieces</th>
              <th className='col-planned'>Gross WT</th>
              <th className='col-planned'
                title="Totalled into the flight's PFM field when this plan is flown">
                Chargeable WT
              </th>
              <th>Load Plan</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((x, i) => (
              <tr key={i}>
                <td className='row-no'>{i + 1}</td>
                <td style={{ minWidth: 150 }}>
                  <Select showSearch allowClear size='small' style={{ width: '100%' }}
                    optionFilterProp='label' placeholder='Carrier'
                    value={x.AviationCarrierId ?? undefined}
                    disabled={disabled}
                    onChange={(v) => set(i, 'AviationCarrierId', v ?? null)}
                    options={carrierOptions} />
                </td>
                {/* Read off the carrier, never stored per line - the prefix
                    belongs to the airline that issued the number. */}
                <td className='prefix-cell'>{prefixOf(x) || '—'}</td>
                <td style={{ minWidth: 150 }}>
                  <Select showSearch allowClear size='small' style={{ width: '100%' }}
                    placeholder='AWB #'
                    // Searched on the digits, so 214-10000001 and 21410000001
                    // both find the same number.
                    filterOption={(input, option) =>
                      String(option?.search || '').includes(digitsOnly(input))}
                    value={x.AviationAwbId ? String(x.AviationAwbId)
                      : (x.awb ? `${TYPED}${x.awb}` : undefined)}
                    disabled={disabled}
                    onChange={(v) => pickAwb(i, x, v)}>
                    {awbOptionsFor(x).map((o) => (
                      <Select.Option key={o.value} value={o.value} search={o.search} label={o.label}>
                        {o.label}
                      </Select.Option>
                    ))}
                  </Select>
                </td>
                <td style={{ minWidth: 160 }}>
                  <Select showSearch allowClear size='small' style={{ width: '100%' }}
                    optionFilterProp='label' placeholder='Master Agent'
                    value={x.masterAgentId ?? undefined}
                    disabled={disabled}
                    onChange={(v) => set(i, 'masterAgentId', v ?? null)}
                    options={agentOptions} />
                </td>
                <td style={{ minWidth: 140 }}>
                  <Select showSearch allowClear size='small' style={{ width: '100%' }}
                    optionFilterProp='label' placeholder='Destination'
                    value={x.destination || undefined}
                    disabled={disabled}
                    onChange={(v) => set(i, 'destination', v ?? '')}
                    options={airportOptions} />
                </td>
                <td style={{ minWidth: 150 }}>
                  <Select showSearch allowClear size='small' style={{ width: '100%' }}
                    optionFilterProp='label' placeholder='Commodity'
                    value={x.CommodityId ?? undefined}
                    disabled={disabled}
                    onChange={(v) => set(i, 'CommodityId', v ?? null)}
                    options={commodityOptions} />
                </td>
                <td style={{ minWidth: 150 }} className='sl-cell'>
                  <Select showSearch allowClear size='small' style={{ width: '100%' }}
                    optionFilterProp='label' placeholder='Onward carrier'
                    value={x.slCarrierId ?? undefined}
                    disabled={disabled}
                    onChange={(v) => set(i, 'slCarrierId', v ?? null)}
                    options={carrierOptions} />
                </td>
                <td style={{ minWidth: 110 }} className='sl-cell'>
                  <Input size='small' placeholder='e.g. EK-602'
                    value={x.slFlightNo || ''}
                    disabled={disabled}
                    onChange={(e) => set(i, 'slFlightNo', e.target.value)} />
                </td>
                <td style={{ minWidth: 80 }} className='planned-cell'>
                  {numberCell(i, 'pieces', x.pieces, { precision: 0, min: 0 })}
                </td>
                <td style={{ minWidth: 100 }} className='planned-cell'>
                  {numberCell(i, 'grossWeight', x.grossWeight, { step: 0.01, min: 0 })}
                </td>
                <td style={{ minWidth: 110 }} className='planned-cell'>
                  {numberCell(i, 'chargeableWeight', x.chargeableWeight, { step: 0.01, min: 0 })}
                </td>
                <td style={{ minWidth: 180 }}>
                  <Input size='small' placeholder='Build-up, positions, handling…'
                    value={x.loadPlan || ''}
                    disabled={disabled}
                    onChange={(e) => set(i, 'loadPlan', e.target.value)} />
                </td>
                <td>
                  {!disabled && (
                    <CloseCircleOutlined className='remove-line' onClick={() => removeLine(i)} />
                  )}
                </td>
              </tr>
            ))}
            {!lines.length && (
              <tr>
                <td colSpan={15} className='text-center grey-txt fs-12 py-4'>
                  Nothing planned yet.
                </td>
              </tr>
            )}
          </tbody>
          {lines.length > 0 && (
            <tfoot>
              <tr className='totals-row'>
                <td colSpan={9} className='text-end'>Planned totals</td>
                <td className='planned-cell'>{totals.pieces}</td>
                <td className='planned-cell'>{fmt(totals.grossWeight)}</td>
                <td className='planned-cell'>{fmt(totals.chargeableWeight)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </Table>
      </div>

      {!disabled && (
        <a className='add-line' onClick={addLine}>
          <PlusCircleOutlined /> Add Consignment
        </a>
      )}

      <style jsx global>{`
        .pfm-lines table { font-size: 12px; margin-bottom: 4px; }
        .pfm-lines th {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          color: #8a97a3;
          font-weight: 600;
          vertical-align: bottom;
          padding: 4px 6px;
        }
        .pfm-lines td { padding: 3px 6px; vertical-align: middle; }
        .pfm-lines .row-no { color: #b6c0cb; font-variant-numeric: tabular-nums; }
        /* Read off the carrier rather than stored, so it is shown as a value
           and not as a box somebody forgot to enable. */
        .pfm-lines .prefix-cell {
          color: #5b6b7c;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        /* The five headings that register their master. The plus only appears
           on hover: it is an escape hatch, not the column's purpose. */
        .pfm-lines .col-quick { cursor: pointer; }
        .pfm-lines .col-quick .quick-add { opacity: 0; margin-left: 3px; color: #1668dc; }
        .pfm-lines .col-quick:hover { color: #1668dc; }
        .pfm-lines .col-quick:hover .quick-add { opacity: 1; }
        /* The onward booking, tinted as one pair. Read apart, SL-Carrier is
           just a second column of airline names. */
        .pfm-lines .col-sl, .pfm-lines .sl-cell { background: #f7f5fc; }
        /* The three figures the flight will NOT inherit, marked so the
           difference is visible rather than only documented. */
        .pfm-lines .col-planned, .pfm-lines .planned-cell { background: #fbfcfd; }
        .pfm-lines .planned-cell .ant-input-number-input { text-align: right; }
        .pfm-lines .ant-input-number-handler-wrap { display: none !important; }
        .pfm-lines .totals-row td {
          font-weight: 700;
          border-top: 2px solid #cfd6de;
          font-variant-numeric: tabular-nums;
          text-align: right;
        }
        .pfm-lines .remove-line { color: #cf1322; cursor: pointer; }
        .add-line { font-size: 12px; cursor: pointer; }
      `}</style>
    </>
  );
};

export default Lines;
