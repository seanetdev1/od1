/**
 * A freight sea job's Weight is its B/L's Container Info gross weights added
 * up (the user, 2026-11-02) - functions/blWeights blContainerGross, and the
 * Booking Info box that shows it.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { useForm, useWatch } from 'react-hook-form';
import { blContainerGross } from 'functions/blWeights';
import Weights from '../Components/Layouts/JobsLayout/Jobs/WeightComp';

const job = (containers) => ({ id: 1, Bl: containers === undefined ? null : { id: 9, Container_Infos: containers } });

describe('blContainerGross', () => {
  test('adds up the containers\' gross', () => {
    expect(blContainerGross(job([{ gross: '4968' }, { gross: '4968.25' }]))).toBe(9936.25);
  });

  test('to the gram, without float dust', () => {
    expect(blContainerGross(job([{ gross: '0.1' }, { gross: '0.2' }]))).toBe(0.3);
  });

  test('a container with no gross yet counts as none', () => {
    expect(blContainerGross(job([{ gross: '1200' }, { gross: '' }, { gross: null }]))).toBe(1200);
  });

  test('null with no B/L, no containers, or none with a gross - the Weight is typed then', () => {
    expect(blContainerGross(job())).toBeNull();
    expect(blContainerGross(job([]))).toBeNull();
    expect(blContainerGross(job([{ gross: '' }]))).toBeNull();
    expect(blContainerGross(undefined)).toBeNull();
  });
});

const Box = ({ type = 'SE', subType = 'FCL', selectedRecord }) => {
  const { register, control } = useForm({ defaultValues: { subType, weight: 9936 } });
  return <Weights register={register} control={control} type={type} approved={[]} equipments={[]}
    useWatch={useWatch} state={{ selectedRecord }} />;
};
const weightInput = () => screen.getByText(/^Weight/).parentElement.querySelector('input');

describe('the Booking Info Weight box', () => {
  test.each([['SE', 'FCL'], ['SE', 'LCL'], ['SI', 'FCL'], ['SI', 'LCL']])('%s %s: from Container Info, not typed', (type, subType) => {
    render(<Box type={type} subType={subType} selectedRecord={job([{ gross: '9936' }])} />);
    expect(screen.getByText('Weight (Container Info)')).toBeTruthy();
    expect(weightInput().disabled).toBe(true);
  });

  test('typed as before while the B/L has no container weights', () => {
    render(<Box selectedRecord={job([])} />);
    expect(screen.getByText('Weight')).toBeTruthy();
    expect(weightInput().disabled).toBe(false);
  });

  test('an air job is left alone', () => {
    render(<Box type='AE' selectedRecord={job([{ gross: '9936' }])} />);
    expect(screen.getByText('Weight')).toBeTruthy();
    expect(weightInput().disabled).toBe(false);
  });
});
