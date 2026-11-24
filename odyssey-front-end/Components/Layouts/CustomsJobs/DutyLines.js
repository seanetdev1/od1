import React from 'react';
import { Table } from 'react-bootstrap';
import { Select, Input, InputNumber, Checkbox } from 'antd';
import {
  RATE_HEADS, AMOUNT_HEADS, VALUE_FIELDS,
  assessLine, lineTotal, totalDuty, dutyBreakdown, effectiveDutyRate, money, num,
} from 'functions/customsDuty';

// The duty sheet for one goods declaration: one row per ITEM.
//
// A GD is assessed item by item, at RATES rather than amounts - so that is
// what this grid holds and what gets stored. Every figure in money on this
// screen is derived (see functions/customsDuty.js); nothing here writes an
// amount into a rate field or the other way round.
//
// TWO LEVELS, deliberately. The row carries what is on almost every line - the
// item, its value and the handful of rates actually levied. The expanded panel
// carries the rest: the other declared values, the eighteen flat charges, and
// the remarks that explain an unusual one. Putting all thirty-odd fields in
// one row would make the common case unreadable to serve the rare one.

export const blankDutyLine = () => ({
  itemNo: '',
  modelNo: '',
  CommodityId: null,
  quantity: null,
  sroNumber: '',
  originCode: '',
  assessedValue: null,
  fobValue: null,
  cnfValue: null,
  freight: null,
  insuranceValue: null,
  exchangeRate: null,
  landingInsPerc: null,
  isFreight: false,
  isProvision: false,
  // Rates and flat amounts all start unset rather than 0: "not levied" and
  // "levied at nothing" are different answers, and the breakdown drops zeros.
  ...Object.fromEntries(RATE_HEADS.map((h) => [h.field, null])),
  ...Object.fromEntries(AMOUNT_HEADS.map((h) => [h.field, null])),
  exciseRemarks: '',
  stampDutyRemarks: '',
  fineRemarks: '',
  loloRemarks: '',
  climaxId: null,
});

// The rates shown inline. The rest are on the expanded panel - these are the
// ones a Pakistani import declaration levies on nearly every line.
const INLINE_RATES = ['customDutyPerc', 'regulatoryDutyPerc', 'salesTaxPerc', 'incomeTaxPerc'];

const DutyLines = ({ lines, setLines, commodities, disabled }) => {
  const [expanded, setExpanded] = React.useState(() => new Set());

  const toggleExpanded = (i) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  const setField = (i, patch) => {
    setLines((lines || []).map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };

  const addLine = () => setLines([...(lines || []), blankDutyLine()]);

  const removeLine = (i) => {
    setLines((lines || []).filter((_, idx) => idx !== i));
    // The expanded set is keyed by index, so removing a row would otherwise
    // leave a LATER row showing as expanded. Cleared rather than re-mapped:
    // guessing which panels the user still wants open is worse than closing
    // them all.
    setExpanded(new Set());
  };

  const commodityOptions = React.useMemo(
    () => (commodities || []).map((c) => ({ value: c.id, label: c.name })),
    [commodities]
  );

  const total = totalDuty(lines);
  const breakdown = dutyBreakdown(lines);
  const rate = effectiveDutyRate(lines);
  const assessedTotal = (lines || []).reduce((t, l) => t + num(l.assessedValue), 0);

  const numberCell = (i, field, extra = {}) => (
    <InputNumber
      size='small' controls={false} style={{ width: '100%' }}
      value={lines[i][field]} disabled={disabled}
      onChange={(v) => setField(i, { [field]: v })}
      {...extra}
    />
  );

  return (
    <div className='customs-duty'>
      <div className='duty-toolbar'>
        <span className='duty-figure'>
          Assessed <b>{money(assessedTotal)}</b>
          <span className='sep'>·</span>
          Total duty <b>{money(total)}</b>
          {rate !== null && <span className='eff'>{rate.toFixed(2)}% effective</span>}
        </span>
        <button type='button' className='btn-custom' disabled={disabled} onClick={addLine}>
          Add Item +
        </button>
      </div>

      <Table size='sm' className='mb-0 duty-table'>
        <colgroup>
          <col style={{ width: '3%'  }} />
          <col style={{ width: '7%'  }} />
          <col style={{ width: '20%' }} />
          <col style={{ width: '8%'  }} />
          <col style={{ width: '13%' }} />
          {INLINE_RATES.map((f) => <col key={f} style={{ width: '7%' }} />)}
          <col style={{ width: '14%' }} />
          <col style={{ width: '3%'  }} />
        </colgroup>
        <thead>
          <tr>
            <th></th>
            <th>Item</th>
            <th>Commodity</th>
            <th className='num'>Qty</th>
            <th className='num'>Assessed Value</th>
            {INLINE_RATES.map((f) => {
              const h = RATE_HEADS.find((x) => x.field === f);
              return <th key={f} className='num' title={h.label}>{h.short} %</th>;
            })}
            <th className='num'>Line Duty</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {(lines || []).map((line, i) => {
            const open = expanded.has(i);
            const assessed = assessLine(line);
            return (
              <React.Fragment key={i}>
                <tr className='f'>
                  <td className='text-center'>
                    <a className='expander' onClick={() => toggleExpanded(i)}
                      title={open ? 'Hide the rest of this line' : 'Show values, charges and remarks'}>
                      {open ? '−' : '+'}
                    </a>
                  </td>
                  <td>
                    <Input size='small' value={line.itemNo || ''} disabled={disabled}
                      onChange={(e) => setField(i, { itemNo: e.target.value })} />
                  </td>
                  <td>
                    <Select size='small' style={{ width: '100%' }} value={line.CommodityId ?? undefined}
                      allowClear showSearch optionFilterProp='label' placeholder='Commodity'
                      disabled={disabled}
                      onChange={(v) => setField(i, { CommodityId: v ?? null })}
                      options={commodityOptions} />
                  </td>
                  <td className='num'>{numberCell(i, 'quantity')}</td>
                  <td className='num'>{numberCell(i, 'assessedValue', { step: 0.01 })}</td>
                  {INLINE_RATES.map((f) => (
                    <td className='num' key={f}>{numberCell(i, f, { step: 0.01, max: 100 })}</td>
                  ))}
                  <td className='num'><span className='derived'>{money(assessed.total)}</span></td>
                  <td className='text-center'>
                    {!disabled && (
                      <a className='red-txt' onClick={() => removeLine(i)} title='Remove this item'>&times;</a>
                    )}
                  </td>
                </tr>

                {open && (
                  <tr className='duty-detail'>
                    <td></td>
                    <td colSpan={INLINE_RATES.length + 6}>
                      <div className='detail-grid'>
                        <div className='detail-block'>
                          <div className='detail-head'>Declared values</div>
                          {VALUE_FIELDS.filter((v) => v.field !== 'assessedValue').map((v) => (
                            <label key={v.field}>
                              <span>{v.label}</span>
                              {numberCell(i, v.field, { step: 0.01 })}
                            </label>
                          ))}
                          <label className='flags'>
                            <Checkbox checked={Boolean(line.isFreight)} disabled={disabled}
                              onChange={(e) => setField(i, { isFreight: e.target.checked })}>
                              <span className='fs-11'>Freight included</span>
                            </Checkbox>
                            <Checkbox checked={Boolean(line.isProvision)} disabled={disabled}
                              onChange={(e) => setField(i, { isProvision: e.target.checked })}>
                              <span className='fs-11'>Provisional</span>
                            </Checkbox>
                          </label>
                        </div>

                        <div className='detail-block'>
                          <div className='detail-head'>Other rates</div>
                          {RATE_HEADS.filter((h) => !INLINE_RATES.includes(h.field)).map((h) => (
                            <label key={h.field}>
                              <span title={h.label}>{h.label} %</span>
                              {numberCell(i, h.field, { step: 0.01, max: 100 })}
                            </label>
                          ))}
                        </div>

                        <div className='detail-block wide'>
                          <div className='detail-head'>
                            Charges &amp; penalties
                            <span className='grey-txt'>entered as amounts, not rates</span>
                          </div>
                          <div className='amount-grid'>
                            {AMOUNT_HEADS.map((h) => (
                              <label key={h.field}>
                                <span>{h.label}</span>
                                {numberCell(i, h.field, { step: 0.01 })}
                              </label>
                            ))}
                          </div>
                        </div>

                        <div className='detail-block wide'>
                          <div className='detail-head'>Reference &amp; remarks</div>
                          <div className='amount-grid'>
                            <label>
                              <span title='The Statutory Regulatory Order claimed on this line'>SRO No.</span>
                              <Input size='small' value={line.sroNumber || ''} disabled={disabled}
                                onChange={(e) => setField(i, { sroNumber: e.target.value })} />
                            </label>
                            <label>
                              <span title='Duty rates vary by origin under trade agreements'>Origin</span>
                              <Input size='small' value={line.originCode || ''} disabled={disabled}
                                onChange={(e) => setField(i, { originCode: e.target.value })} />
                            </label>
                            <label>
                              <span>Model No.</span>
                              <Input size='small' value={line.modelNo || ''} disabled={disabled}
                                onChange={(e) => setField(i, { modelNo: e.target.value })} />
                            </label>
                            {[
                              ['exciseRemarks', 'Excise remarks'],
                              ['stampDutyRemarks', 'Stamp duty remarks'],
                              ['fineRemarks', 'Fine remarks'],
                              ['loloRemarks', 'LOLO remarks'],
                            ].map(([field, label]) => (
                              <label key={field}>
                                <span>{label}</span>
                                <Input size='small' value={line[field] || ''} disabled={disabled}
                                  onChange={(e) => setField(i, { [field]: e.target.value })} />
                              </label>
                            ))}
                          </div>
                        </div>

                        {/* The cascade, shown rather than implied. Each head
                            with the base it was charged on - which is what
                            makes checking this against the GD two columns
                            rather than reverse-engineering a formula. */}
                        {assessed.heads.length > 0 && (
                          <div className='detail-block wide'>
                            <div className='detail-head'>
                              How this line was assessed
                              <span className='grey-txt'>base × rate, in the order applied</span>
                            </div>
                            <table className='cascade'>
                              <thead>
                                <tr><th>Head</th><th className='num'>Rate</th><th className='num'>Charged on</th><th className='num'>Amount</th></tr>
                              </thead>
                              <tbody>
                                {assessed.heads.map((h) => (
                                  <tr key={h.field}>
                                    <td>{h.label}</td>
                                    <td className='num'>{h.perc === null ? '—' : `${h.perc}%`}</td>
                                    <td className='num'>{h.base === null ? '—' : money(h.base)}</td>
                                    <td className='num'>{money(h.amount)}</td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot>
                                <tr><td colSpan={3}>Line total</td><td className='num'><b>{money(assessed.total)}</b></td></tr>
                              </tfoot>
                            </table>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}

          {!(lines || []).length && (
            <tr><td colSpan={INLINE_RATES.length + 7} className='text-center grey-txt py-3'>
              No duty assessed yet. Add an item for each line on the declaration.
            </td></tr>
          )}
        </tbody>
      </Table>

      {/* The declaration's totals, per head. The question people actually ask
          is "what is the sales tax on this GD", not "on line 3". */}
      {breakdown.length > 0 && (
        <div className='duty-summary'>
          <div className='duty-summary-head'><b>Declaration totals</b></div>
          <table className='cascade'>
            <thead>
              <tr><th>Head</th><th className='num'>Rate</th><th className='num'>Amount</th></tr>
            </thead>
            <tbody>
              {breakdown.map((h) => (
                <tr key={h.field}>
                  <td>{h.label}</td>
                  {/* null means the lines disagree - showing one line's rate
                      as if it covered all of them is a number that checks out
                      against nothing. */}
                  <td className='num'>{h.perc === null ? <span className='grey-txt'>mixed</span> : `${h.perc}%`}</td>
                  <td className='num'>{money(h.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={2}>Total duty &amp; taxes</td><td className='num'><b>{money(total)}</b></td></tr>
            </tfoot>
          </table>
        </div>
      )}

      <style jsx global>{`
        .customs-duty .duty-toolbar {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 10px;
        }
        .customs-duty .duty-figure {
          font-size: 13px;
          font-variant-numeric: tabular-nums;
        }
        .customs-duty .duty-figure .sep { margin: 0 8px; color: #ccc; }
        .customs-duty .duty-figure .eff { margin-left: 10px; color: #999; font-size: 12px; }
        .customs-duty .duty-toolbar > button { margin-left: auto; }
        .customs-duty .duty-table th {
          font-size: 11px;
          font-weight: 600;
          color: #666;
          white-space: nowrap;
        }
        .customs-duty .duty-table td { vertical-align: middle; }
        .customs-duty .duty-table .num { text-align: right; }
        .customs-duty .duty-table .derived {
          font-variant-numeric: tabular-nums;
          color: #444;
        }
        .customs-duty .expander {
          display: inline-block;
          width: 18px; height: 18px;
          line-height: 16px;
          text-align: center;
          border: 1px solid #ddd;
          border-radius: 4px;
          color: #666;
          user-select: none;
        }
        .customs-duty .expander:hover { border-color: #1890ff; color: #1890ff; }
        .customs-duty .duty-detail > td { background: #fafcff; }
        .customs-duty .detail-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 18px;
          padding: 10px 4px 14px;
        }
        .customs-duty .detail-block { min-width: 200px; }
        .customs-duty .detail-block.wide { flex: 1 1 100%; }
        .customs-duty .detail-head {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #999;
          margin-bottom: 6px;
          display: flex;
          gap: 8px;
          align-items: baseline;
        }
        .customs-duty .detail-head .grey-txt { text-transform: none; letter-spacing: 0; }
        .customs-duty .detail-block label {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 4px;
          font-size: 12px;
        }
        .customs-duty .detail-block label > span {
          flex: 0 0 130px;
          color: #666;
        }
        .customs-duty .detail-block label.flags { gap: 14px; margin-top: 8px; }
        .customs-duty .amount-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
          gap: 2px 18px;
        }
        .customs-duty .cascade {
          width: 100%;
          max-width: 560px;
          font-size: 12px;
          font-variant-numeric: tabular-nums;
        }
        .customs-duty .cascade th {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #999;
          font-weight: 600;
          border-bottom: 1px solid #eee;
          padding: 2px 6px;
        }
        .customs-duty .cascade td { padding: 2px 6px; }
        .customs-duty .cascade .num { text-align: right; }
        .customs-duty .cascade tfoot td { border-top: 1px solid #eee; }
        .customs-duty .duty-summary {
          margin-top: 16px;
          padding: 12px 14px;
          border: 1px solid #eee;
          border-radius: 8px;
          background: #fcfcfc;
          max-width: 600px;
        }
        .customs-duty .duty-summary-head { margin-bottom: 8px; }
      `}</style>
    </div>
  );
};

export default DutyLines;
