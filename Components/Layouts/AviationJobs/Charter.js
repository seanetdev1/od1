import React from 'react';
import { Checkbox, InputNumber, Tag } from 'antd';
import { charterAppliesTo, charterRates } from 'functions/aviationCharter';

// The charter strip, above the consignment grid.
//
// A charter is the whole aircraft sold as one deal, so it is priced once here
// rather than AWB by AWB below - see functions/aviationCharter for which
// consignments the common rates reach and why they are pre-filled rather than
// imposed.
//
// The four rate boxes are DISABLED until Charter is ticked. They are shown
// rather than hidden so the screen says what ticking the box is going to ask
// for; a strip that grew four fields on click reads as the form changing
// shape under the user.
const Charter = ({ job, lines, carriers, disabled, onChange }) => {
  const on = Boolean(job?.charter);
  const airline = (carriers || []).find((c) => c.id === job?.operatingCarrierId);

  // How much of the load the common rates actually reach. Said out loud
  // because "charter" and "every AWB on this flight" are not the same thing,
  // and a charter whose rates reach nothing is almost always a flight whose
  // Airline has not been picked or whose AWBs name a different carrier.
  const reached = (lines || []).filter((l) => charterAppliesTo(l, job)).length;
  const priceable = (lines || []).filter((l) => l.AviationCarrierId).length;

  const rate = (field, label, hint) => (
    <div className='charter-field'>
      <span className='label'>{label}</span>
      <InputNumber
        size='small' controls={false} step={0.01} style={{ width: 100 }}
        value={job?.[field]}
        placeholder={hint}
        disabled={!on || disabled}
        onChange={(v) => onChange({ ...job, [field]: v })}
      />
    </div>
  );

  return (
    <div className={`charter-strip ${on ? 'on' : ''}`}>
      <Checkbox
        checked={on}
        disabled={disabled}
        onChange={(e) => onChange({
          ...job,
          charter: e.target.checked,
          // Turning it OFF leaves the rates where they are rather than
          // blanking them: the AWBs below already carry the figures that were
          // copied down, and wiping the source would make it impossible to see
          // afterwards what the charter had been priced at.
        })}
      >
        <b>Charter</b>
      </Checkbox>

      <span className='charter-note'>
        {on
          ? <>one deal for the aircraft — applied to AWBs carried for {
              airline ? <b>{airline.name}</b> : <i>the operating airline</i>
            }</>
          : <>tick to price the whole aircraft as one deal</>}
      </span>

      {/* Grouped per SIDE - rate then its own conversion - because that is
          the pair that produces one side's figure in the books, and because
          the two sides are genuinely two deals: the aircraft is bought in one
          currency and the space on it is often sold in another. */}
      {rate('charterBuyingRate',    'Buying',   'per kg')}
      {rate('charterBuyingExRate',  'Buy ex.',  '1')}
      {rate('charterSellingRate',   'Selling',  'per kg')}
      {rate('charterSellingExRate', 'Sell ex.', '1')}

      {on && (
        <span className='charter-reach'>
          {!job?.operatingCarrierId ? (
            <Tag color='orange'>
              Pick the flight&apos;s Airline on Flight Info — without it the charter reaches no AWB
            </Tag>
          ) : reached === 0 ? (
            <Tag color='orange'>
              {priceable === 0
                ? 'No AWB names a carrier yet'
                : `No AWB is carried for ${airline?.name || 'the operating airline'}`}
            </Tag>
          ) : (
            <Tag color='blue'>{reached} AWB{reached === 1 ? '' : 's'} priced at these rates</Tag>
          )}
        </span>
      )}

      <style jsx global>{`
        .charter-strip {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 14px;
          padding: 7px 12px;
          margin-bottom: 6px;
          border: 1px solid #e6eef5;
          border-radius: 6px;
          background: #fafcfe;
        }
        /* A charter changes how the whole grid below is priced, so the strip
           reads as switched ON rather than as one more row of fields. */
        .charter-strip.on {
          border-color: #91caff;
          background: #f0f7ff;
        }
        .charter-strip .charter-note { font-size: 11px; color: #8a97a3; }
        .charter-strip .charter-field {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .charter-strip .charter-field .label {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #8a97a3;
        }
        .charter-strip .charter-reach { margin-left: auto; }
        .charter-strip .ant-tag { margin-right: 0; font-size: 11px; }
        /* The strip sits inside .client-styles, which stretches every label to
           170px to line the party form up - see the same note in
           Consignments. Undone here or the checkbox drags the strip apart. */
        .charter-strip .ant-checkbox-wrapper { min-width: 0 !important; margin: 0; }
      `}</style>
    </div>
  );
};

export { charterRates };
export default Charter;
