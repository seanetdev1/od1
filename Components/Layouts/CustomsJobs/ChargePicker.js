import React from 'react';
import { Modal, Input, Empty, Tag } from 'antd';
import { rankedCharges } from 'functions/chargeSearch';

/**
 * Picking a charge, with enough on screen to know which one it is.
 *
 * THE PROBLEM WITH THE DROPDOWN IT REPLACES. The charge column is a tenth of
 * the table's width, so its picker could only ever show one line - and that
 * line was "(THC) Terminal". The code and a truncated short name. Everything
 * that tells two similar charges apart is in the FULL name, which the dropdown
 * had no room for: "Terminal Handling - Import" and "Terminal Handling -
 * Export" were both "(THC) Terminal" and "(THCE) Terminal", and the only way
 * to know which was which was to pick one and read the Particular column
 * afterwards.
 *
 * A modal has the room. All three identities are columns, so the charge is
 * chosen from the description rather than from an abbreviation of it.
 *
 * KEYBOARD FIRST, because this replaces a control people used without their
 * hands leaving the keyboard and it must not cost them that:
 *
 *   type       filters, across all three fields - see functions/chargeSearch
 *   up/down    move the highlight
 *   enter      take the highlighted row
 *   esc        leave, changing nothing
 *
 * The search box takes focus on open, so a practised user types three letters
 * and presses Enter without ever seeing the list settle.
 */
const ChargePicker = ({ open, charges, value, onPick, onCancel, initialQuery = '' }) => {
  const [query, setQuery] = React.useState('');
  const [cursor, setCursor] = React.useState(0);
  const searchRef = React.useRef(null);
  const listRef = React.useRef(null);

  const rows = React.useMemo(() => rankedCharges(charges, query), [charges, query]);

  /* Opening resets the search, rather than reopening on the last one. The
   * previous query belongs to the previous row and a picker that opens
   * pre-filtered to something unrelated looks like it has lost most of the
   * master. */
  React.useEffect(() => {
    if (!open) return;
    // What was typed in the charge box before pressing Enter, if anything -
    // see ChargeCodeInput. Otherwise the search starts empty.
    setQuery(initialQuery || '');
    // The row already on the charge line starts highlighted, so opening the
    // picker on a charge that is already set and pressing Enter changes
    // nothing - which is what "I only wanted to look" should do.
    const at = (charges || []).findIndex((c) => String(c.id) === String(value));
    setCursor(at > 0 ? at : 0);
  }, [open, value, charges, initialQuery]);

  // Typing moves the highlight back to the top: the old position belonged to
  // the old list, and leaving it where it was would have Enter take whichever
  // charge happened to land at that index.
  React.useEffect(() => { setCursor(0); }, [query]);

  // Keep the highlight in view when it is moved by the keyboard.
  React.useEffect(() => {
    const el = listRef.current?.querySelector('.cp-row.is-on');
    if (el?.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [cursor, rows]);

  const take = (charge) => { if (charge) onPick(charge); };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      take(rows[cursor]);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      title='Choose a charge'
      /* CLEARING IS AN OPTION, because it was one on the dropdown this
         replaces (`allowClear`) and because a line with no charge is a real
         line: an ad-hoc cost typed as a description and an amount, which the
         save path keeps. Losing that would be a quiet removal of something
         people use. In the footer rather than as a row in the list, so it
         cannot be hit by Enter while searching. */
      footer={value ? (
        <button type='button' className='cp-clear' onClick={() => onPick(null)}>
          Clear this charge
        </button>
      ) : null}
      width={860}
      destroyOnClose
      // The search box, not the modal, so typing works the instant it opens.
      afterOpenChange={(o) => { if (o) searchRef.current?.focus({ cursor: 'end' }); }}
    >
      <div className='charge-picker' onKeyDown={onKeyDown}>
        <Input
          ref={searchRef}
          allowClear
          size='large'
          placeholder='Search by code, short name or description — e.g. THC, terminal, import'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className='cp-count'>
          {rows.length} of {(charges || []).length} charges
          <span className='cp-hint'>&uarr;&darr; to move · Enter to choose · Esc to close</span>
        </div>

        <div className='cp-head'>
          <span className='cp-code'>Code</span>
          <span className='cp-short'>Short Name</span>
          <span className='cp-full'>Full Name</span>
          <span className='cp-meta'>Basis / Currency</span>
        </div>

        <div className='cp-list' ref={listRef}>
          {rows.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={(charges || []).length
                ? `Nothing matches “${query}”.`
                : 'No charges are set up yet. Add them in Setup > Charges.'}
            />
          ) : rows.map((c, i) => (
            <button
              type='button'
              key={c.id}
              className={`cp-row${i === cursor ? ' is-on' : ''}${String(c.id) === String(value) ? ' is-current' : ''}`}
              onMouseEnter={() => setCursor(i)}
              onClick={() => take(c)}
            >
              <span className='cp-code'>{c.code || <em>&mdash;</em>}</span>
              <span className='cp-short'>{c.short || <em>&mdash;</em>}</span>
              {/* The reason the modal exists. Never truncated with an
                  ellipsis - it wraps instead, because the tail of a charge
                  name is usually the half that identifies it ("... - Import"). */}
              <span className='cp-full'>{c.fullName || c.name || <em>&mdash;</em>}</span>
              <span className='cp-meta'>
                {c.calculationType && (
                  <Tag color={c.calculationType === 'Per Unit' ? 'blue' : 'default'}>
                    {c.calculationType === 'Per Unit' ? 'P/Unit' : 'P/Shpt'}
                  </Tag>
                )}
                {c.currency && <Tag>{c.currency}</Tag>}
              </span>
            </button>
          ))}
        </div>
      </div>

      <style jsx global>{`
        .charge-picker .cp-count {
          display: flex;
          align-items: baseline;
          gap: 10px;
          font-size: 11px;
          color: #999;
          margin: 10px 2px 6px;
        }
        .charge-picker .cp-hint { margin-left: auto; }
        .charge-picker .cp-head,
        .charge-picker .cp-row {
          display: grid;
          grid-template-columns: 90px 170px 1fr 130px;
          gap: 12px;
          align-items: start;
          padding: 8px 10px;
          text-align: left;
        }
        .charge-picker .cp-head {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #999;
          border-bottom: 1px solid #eee;
          padding-bottom: 6px;
        }
        .charge-picker .cp-list {
          max-height: 52vh;
          overflow-y: auto;
        }
        .charge-picker .cp-row {
          width: 100%;
          border: 0;
          border-bottom: 1px solid #f5f5f5;
          background: transparent;
          cursor: pointer;
          font-size: 13px;
          line-height: 1.35;
        }
        /* One highlight, driven by the cursor - the mouse moves it rather than
           painting a second one, so there is never a hovered row and a
           keyboard-selected row disagreeing about what Enter will take. */
        .charge-picker .cp-row.is-on { background: #e6f4ff; }
        .charge-picker .cp-row .cp-code {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-weight: 600;
          color: #1677ff;
        }
        .charge-picker .cp-row .cp-short { font-weight: 600; }
        .charge-picker .cp-row .cp-full { color: #444; }
        .charge-picker .cp-row em { color: #ccc; font-style: normal; }
        .charge-picker .cp-row.is-current .cp-short::after {
          content: 'current';
          font-size: 9px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #999;
          margin-left: 6px;
          vertical-align: middle;
        }
        .charge-picker .cp-meta { text-align: right; }
        .charge-picker .cp-meta .ant-tag { margin-inline-end: 0; margin-left: 4px; }
        .ant-modal-footer .cp-clear {
          border: 1px solid #ffccc7;
          background: #fff;
          color: #cf1322;
          border-radius: 4px;
          padding: 3px 12px;
          font-size: 12px;
          cursor: pointer;
        }
        .ant-modal-footer .cp-clear:hover { border-color: #cf1322; }
      `}</style>
    </Modal>
  );
};

export default ChargePicker;
