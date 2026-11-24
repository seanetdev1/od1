import { Select } from "antd";
import { useController } from "react-hook-form";
import React from 'react'

/* clearTo: what the cross sets the field to, for a field that may be left
 * empty (Inco Terms: null). The cross hands onChange `undefined`, and
 * react-hook-form reads an undefined field as "not set" - the box went back
 * to the value the form started with, and the save left `undefined` out, so
 * the old value stayed on the record: Inco Terms could not be unselected (the
 * user, 2026-11-04). Not every field takes it: several here may not be saved
 * empty (a voucher's currency and line type, a setup charge's defaults), so
 * a field opts in. */
const SelectComp = (props) => {
  const { control, name,defaultValue } = props;
  const clears = Object.prototype.hasOwnProperty.call(props, 'clearTo');

  const { field: { onChange, onBlur, value, name: fieldName, ref } } = useController({ control, name, defaultValue});

return(
    <>
    <div>{props.label}</div>
      <Select disabled={props.disabled} style={{minWidth:props.width, fontSize:12}} allowClear
        name={fieldName} onChange={(v) => onChange(v === undefined && clears ? props.clearTo : v)} value={value} ref={ref} onBlur={onBlur} showSearch
        defaultValue={defaultValue}
         {...props.rest}
      >
        {
          props.options.map((x, index) => {
            return(
              <Select.Option key={index} value={x.id}>{x.name}</Select.Option>
            )
          })
        }
      </Select>
    </>
)}

export default React.memo(SelectComp)
