import React from 'react';
import { Input, Button, Select } from 'antd';
import { EQUIPMENT_SIZES } from 'functions/equipmentSizes';

/**
 * The containers on a goods declaration.
 *
 * WHY IT IS A GRID AND NOT A TEXT BOX
 *
 * Customs_Job.containers is a comma-separated string, on the reasoning that a
 * clearance file quotes container numbers rather than managing them. The
 * legacy system keeps them as rows - 6,164 of them across 5,744 clearing jobs,
 * 5,915 distinct numbers - and held as one string nothing can search by
 * container number and the size type is lost.
 *
 * The string field is kept alongside this. It is what a clerk types when they
 * have a list off a document and no interest in rows.
 *
 * WHY SO FEW COLUMNS
 *
 * The legacy grid shows eighteen: Container#, Size Type, Rate Group, Seal #1-3,
 * Gross WT, Net WT, WT Unit, CBM, Packages, Unit, Temperature, Load Type, SOC,
 * Part FCL, COC, DG Non DG, Remarks.
 *
 * Measured across all 6,164 of their rows, TWO are populated: Container# and
 * Size Type. Gross and Net WT appear on 241, CBM on 3, Packages on 5. Seals,
 * Temperature, WT Unit, Load Type, SOC, Part FCL, COC and DG Non DG are empty
 * on every single row.
 *
 * So the grid holds what the work actually uses. Reproducing sixteen columns
 * nobody fills would make the screen harder to use in exchange for nothing -
 * and this is a form used all day by people who asked for it to be simpler.
 */
/* TRANSPORTER, when the job form passes its transporter list: who hauls each
   box. The Program Book's container section records it per container (the
   user's request, 2026-10-10), and a moved plan brings it here. */
/* SIZE FROM THE LIST - `sizeList`, Configuration > Customs (Essani,
   2026-11-14): the freight sizes (functions/equipmentSizes), picked rather
   than typed. A size already on a row stays offered, whatever it is. */
const sizeOptions = (current) => [
  ...EQUIPMENT_SIZES,
  ...(current && !EQUIPMENT_SIZES.includes(current) ? [current] : []),
].map((s) => ({ value: s, label: s }));

const Containers = ({ rows, setRows, disabled, transporters, sizeList = false }) => {
  const list = Array.isArray(rows) ? rows : [];
  const withTransporter = Array.isArray(transporters);
  const transporterOptions = (transporters || []).map((t) => ({ value: t.id, label: t.name }));

  const update = (i, field, value) =>
    setRows(list.map((r, n) => (n === i ? { ...r, [field]: value } : r)));

  const add = () => setRows([...list, { sizeType: '', containerNo: '', truckNo: '' }]);
  const remove = (i) => setRows(list.filter((_, n) => n !== i));

  return (
    <div className='cj-grid'>
      <table className='cj-table'>
        <thead>
          <tr>
            {withTransporter && <th style={{ width: '26%' }}>Transporter</th>}
            <th style={{ width: withTransporter ? '16%' : '22%' }}>Size</th>
            <th style={{ width: withTransporter ? '25%' : '34%' }}>Container #</th>
            <th style={{ width: withTransporter ? '25%' : '34%' }}>Truck #</th>
            <th style={{ width: 48 }} aria-label='Remove' />
          </tr>
        </thead>
        <tbody>
          {list.length === 0 && (
            <tr className='cj-empty'>
              <td colSpan={withTransporter ? 5 : 4}>No containers listed.</td>
            </tr>
          )}
          {list.map((r, i) => (
            <tr key={i}>
              {withTransporter && (
                <td>
                  <Select
                    value={r.transporterId ?? undefined} options={transporterOptions}
                    onChange={(v) => update(i, 'transporterId', v ?? null)}
                    showSearch allowClear optionFilterProp='label' style={{ width: '100%' }}
                    disabled={disabled} aria-label={`Container ${i + 1} transporter`}
                  />
                </td>
              )}
              <td>
                {sizeList ? (
                  <Select
                    value={r.sizeType || undefined} options={sizeOptions(r.sizeType)}
                    onChange={(v) => update(i, 'sizeType', v ?? '')}
                    showSearch allowClear placeholder='40HC' style={{ width: '100%' }}
                    disabled={disabled} aria-label={`Container ${i + 1} size`}
                  />
                ) : (
                  <Input
                    value={r.sizeType || ''}
                    onChange={(e) => update(i, 'sizeType', e.target.value)}
                    placeholder='40HC' disabled={disabled}
                  />
                )}
              </td>
              <td>
                <Input
                  value={r.containerNo || ''}
                  onChange={(e) => update(i, 'containerNo', e.target.value.toUpperCase())}
                  placeholder='MSKU1234567' disabled={disabled}
                />
              </td>
              <td>
                <Input
                  value={r.truckNo || ''}
                  onChange={(e) => update(i, 'truckNo', e.target.value.toUpperCase())}
                  disabled={disabled}
                />
              </td>
              <td className='cj-rowdel'>
                <button
                  type='button' className='cj-del' onClick={() => remove(i)}
                  disabled={disabled} aria-label={`Remove container ${i + 1}`}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className='cj-grid-foot'>
        <Button onClick={add} disabled={disabled} size='large'>+ Add container</Button>
        {list.length > 0 && (
          <span className='cj-count'>
            {list.length} container{list.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
    </div>
  );
};

export default Containers;
