import React from 'react';
import { Input } from 'antd';
import { LoadingOutlined, SearchOutlined } from '@ant-design/icons';
import openNotification from 'Components/Shared/Notification';

/**
 * A Direct Job line's job - typed, or searched for. Works as the charge box on
 * a customs job does (CustomsJobs/ChargeCodeInput), asked for 2026-11-13.
 *
 * It used to be a box you clicked to open the job list, every time, so even
 * someone holding the job number had to open a modal and search for it.
 *
 *   type the whole job number,  that job is taken (any case). One that is not
 *   then leave                  there puts back what was in the box and says so
 *   Enter                       opens the job list, searching for what was typed
 *   the magnifier               the same, for a mouse
 *
 * Only a WHOLE number is taken on leaving: "CCJ-1/27" is not "CCJ-11/27", and
 * picking whichever job happened to contain the text would put the money on
 * the wrong job without a word. Part of a number is what Enter is for.
 *
 * @param value     the job number on the line
 * @param findJob   (text) => Promise of the jobs numbered exactly that
 * @param onPick    (job) => void, with the job list's row ({ id, jobNo, fileNo })
 * @param onSearch  (text) => void - open the job list searching for it
 */
const JobNumberInput = ({ value, disabled, findJob, onPick, onSearch, style }) => {
  const shown = String(value || '');
  // null while not being typed in, so the box follows the line's job.
  const [draft, setDraft] = React.useState(null);
  const [looking, setLooking] = React.useState(false);
  // Refs as well as state, as in ChargeCodeInput: Enter opens the job list,
  // which takes the focus, and the blur that follows must not also look the
  // text up.
  const draftRef = React.useRef(null);
  const skipBlur = React.useRef(false);
  const mounted = React.useRef(true);
  React.useEffect(() => () => { mounted.current = false; }, []);

  const setTyped = (v) => { draftRef.current = v; setDraft(v); };

  const commit = async () => {
    if (skipBlur.current) { skipBlur.current = false; return; }
    const typed = (draftRef.current ?? '').trim();
    if (!typed || typed.toLowerCase() === shown.toLowerCase()) { setTyped(null); return; }

    // The typed text stays in the box while it is looked up.
    setLooking(true);
    let found;
    try {
      found = await findJob(typed);
    } catch (e) {
      found = null;
    }
    if (!mounted.current) return;
    setLooking(false);
    setTyped(null);

    if (found === null) {
      openNotification('Error', `Job "${typed}" could not be looked up. Press Enter in the Job # box to search.`, 'red');
    } else if (found.length === 1) {
      onPick(found[0]);
    } else if (found.length > 1) {
      // The same number twice - let them choose which.
      onSearch(typed);
    } else {
      openNotification('No such job', `No job is numbered "${typed}". Press Enter in the Job # box to search.`, 'orange');
    }
  };

  const search = () => {
    if (disabled) return;
    skipBlur.current = true;
    const typed = (draftRef.current ?? '').trim();
    setTyped(null);
    onSearch(typed);
  };

  return (
    <Input
      value={draft ?? shown}
      placeholder='Job #'
      aria-label='Job #'
      disabled={disabled}
      style={style}
      title='Type the whole job number, or press Enter to search'
      onChange={(e) => setTyped(e.target.value)}
      onFocus={() => { skipBlur.current = false; }}
      onBlur={commit}
      onPressEnter={(e) => { e.preventDefault(); search(); }}
      suffix={looking ? <LoadingOutlined style={{ color: '#999' }} /> : (
        <SearchOutlined
          aria-label='Search jobs'
          style={{ cursor: disabled ? 'not-allowed' : 'pointer', color: '#999' }}
          // Keep the focus in the box, so the click is not also a blur.
          onMouseDown={(e) => e.preventDefault()}
          onClick={search}
        />
      )}
    />
  );
};

export default JobNumberInput;
