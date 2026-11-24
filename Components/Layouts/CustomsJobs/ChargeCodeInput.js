import React from 'react';
import { Input } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import openNotification from 'Components/Shared/Notification';
import { chargesTyped } from 'functions/chargeSearch';

/**
 * The charge on a line, shown by its SHORT NAME - typed, or searched for.
 *
 * Clicking the cell used to open ChargePicker every time. People who know the
 * codes - most of them - had to open a modal to type three letters into it.
 * Now the cell is a box:
 *
 *   type a short name or code,  the charge with that short name is taken - or,
 *   then leave                  if no short name matches, the one with that
 *                               code. An unknown one puts back what was there
 *                               and says so; one the master repeats opens the
 *                               picker
 *   Enter                       opens the picker, searching for what was typed
 *   the magnifier               the same, for a mouse
 *
 * When not being typed in, the box shows the line's short name ("LABOUR FEE"):
 * it reads as the charge, where the code - a bare number on most installs -
 * did not. The code is in the tooltip, and the picker shows all three.
 */
const ChargeCodeInput = ({ charge, charges, disabled, onPick, onSearch, autoFocus = false }) => {
  const shown = charge ? String(charge.short || charge.code || charge.name || '') : '';
  // null while not being typed in, so the box follows the line's charge.
  const [draft, setDraft] = React.useState(null);
  // Refs as well as state: Enter opens the picker, which takes the focus, and
  // the blur that follows runs with the render's stale draft. It must not
  // also try to look the text up.
  const draftRef = React.useRef(null);
  const skipBlur = React.useRef(false);

  const setTyped = (value) => { draftRef.current = value; setDraft(value); };

  const commit = () => {
    if (skipBlur.current) { skipBlur.current = false; return; }
    const text = (draftRef.current ?? '').trim();
    setTyped(null);
    if (!text || text.toLowerCase() === shown.toLowerCase()) return;
    const found = chargesTyped(charges, text);
    if (found.length === 1) onPick(found[0]);
    else if (found.length > 1) onSearch(text);
    else {
      openNotification('No such charge', `No charge has the short name or code "${text}". Press Enter in the charge box to search.`, 'orange');
    }
  };

  const search = () => {
    if (disabled) return;
    skipBlur.current = true;
    const text = (draftRef.current ?? '').trim();
    setTyped(null);
    onSearch(text);
  };

  return (
    <Input
      size='small'
      className='charge-code'
      value={draft ?? shown}
      placeholder='Charge'
      disabled={disabled}
      // A line just added - Add +, Alt+R or Alt+B - starts here, so it can be
      // typed without reaching for the mouse.
      autoFocus={autoFocus}
      title={charge
        ? `${charge.short || charge.code} - ${charge.fullName || charge.name}${charge.code ? ` (code ${charge.code})` : ''} - Enter to search`
        : 'Type a charge short name or code, or press Enter to search'}
      onChange={(e) => setTyped(e.target.value)}
      onBlur={commit}
      onPressEnter={(e) => { e.preventDefault(); search(); }}
      suffix={(
        <SearchOutlined
          aria-label='Search charges'
          style={{ cursor: disabled ? 'not-allowed' : 'pointer', color: '#999' }}
          // Keep the focus in the box, so the click is not also a blur.
          onMouseDown={(e) => e.preventDefault()}
          onClick={search}
        />
      )}
    />
  );
};

export default ChargeCodeInput;
