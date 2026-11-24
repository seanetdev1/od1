import { Select } from "antd";
import { useController } from "react-hook-form";
import React from 'react';

const SelectSearchComp = (props) => {
  // onPicked: told of a value the USER picked, after the form has it - never of
  // one set by reset() or setValue(). See Jobs/BookingInfo's client box.
  const { control, name, label, options, disabled, width, clear, required = false, onPicked, ...rest } = props;
  
  const controllerConfig = { control, name };
  if (required) {
    controllerConfig.rules = { required: `${label} is required` };
  }
  
  const { field: { onChange, onBlur, value, name: fieldName, ref } } = useController(controllerConfig);

  const handleValue = value ? value : undefined;

  const SelectSearch = () => {
    let tempVal = options.map((x) => ({
      value: x.id,
      label: x.name,
      code: x.code,
    }));

    return (
    <Select
      showSearch
      disabled={disabled}
      style={{ minWidth: width || 200, maxWidth: width || 200, fontSize: 12 }}
      name={fieldName}
      onChange={onPicked ? (picked, option) => { onChange(picked); onPicked(picked, option); } : onChange}
      value={handleValue}
      onBlur={onBlur}
      optionFilterProp="children"
      filterOption={(input, option) => {
        const label = (option?.label ?? '').toLowerCase();
        const code = String(option?.code ?? ''); // Convert numeric code to string
        const searchInput = input.toLowerCase();
        return label.includes(searchInput) || code.includes(searchInput);
      }}
      options={tempVal}
      allowClear={clear}
      {...rest}
    />
    );
  };

  return (
    <>
      <div className="">{label}</div>
      <SelectSearch />
    </>
  );
};

export default React.memo(SelectSearchComp);

