import React, { useRef } from 'react'
import ReactToPrint from 'react-to-print';
import { SaveOutlined, PrinterOutlined } from '@ant-design/icons';
import PrintComp from './PrintComp';
import Column1 from './Column1';
import Column2 from './Column2';
import Column3 from './Column3';
import { Spinner } from "react-bootstrap";

/* Save and Print, together at the top and alike.
 *
 * Print was a fixed-width pill whose label sat at its left edge (btn-custom
 * lays its content out from the start), and it opened a popover holding a
 * second button, "Go", that did the printing - empty, too, until the program
 * had been saved. Save was at the foot of the form, apart from it. Now Print
 * prints, and says it needs a save first rather than opening an empty bubble. */
const LoadingForm = ({handleSubmit, register, control, onSubmit, state, load, allValues}) => {
  const printRef = useRef(null);
  const saved = Boolean(allValues?.id);

  return (
    <div>
    <form className="d-flex justify-content-between flex-column">
      <div className='lp-actions'>
        <button type="button" className="btn-custom lp-btn" onClick={handleSubmit(onSubmit)} disabled={load}>
          {load ? <Spinner animation='border' size='sm' /> : <SaveOutlined />} Save
        </button>
        {saved ? (
          <ReactToPrint
            content={() => printRef.current}
            trigger={() => (
              <button type="button" className="btn-custom lp-btn"><PrinterOutlined /> Print</button>
            )}
          />
        ) : (
          <button type="button" className="btn-custom lp-btn" disabled title='Save the loading program first, then print it'>
            <PrinterOutlined /> Print
          </button>
        )}
      </div>
    <div className='d-flex d-flex justify-content-between'>

    <Column1 registr={register} control={control} state={state} />
    <Column2 registr={register} control={control} state={state} />
    <Column3 registr={register}  load={load} control={control} state={state} />
    </div>
    </form>
    {/* The letter, out of sight until printed. */}
    <div style={{ display: 'none' }}>
      <div ref={printRef}>
        {saved && <PrintComp allValues={allValues} state={state} />}
      </div>
    </div>
    <style jsx>{`
      .lp-actions { display: flex; gap: 8px; margin: 4px 0 10px; }
      .lp-btn { justify-content: center; min-width: 96px; padding: 5px 16px; }
      .lp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    `}</style>
  </div>
  )
}

export default LoadingForm
