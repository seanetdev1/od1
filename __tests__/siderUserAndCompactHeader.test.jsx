/**
 * The user and Logout at the foot of the sidebar, and the header boxes that
 * shrink on smaller screens (the user, 2026-11-23).
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ChangePassword from '../Components/Shared/ChangePassword';
import useMediaQuery from '../functions/useMediaQuery';

jest.mock('apis/axiosClient', () => ({ post: jest.fn() }));
jest.mock('functions/systemSession', () => ({ isSystemSession: () => false }));

// antd's form grid asks the window's media queries; jsdom has none.
beforeAll(() => {
  window.matchMedia = window.matchMedia || ((query) => ({
    matches: false, media: query, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {},
  }));
});

describe('the user at the foot of the sidebar', () => {
  test('open: the initials, the name and what clicking does', () => {
    render(<ChangePassword username='Noman Ali' variant='sider' collapsed={false} />);
    // The initials are aria-hidden, so the name is what a screen reader reads.
    const button = screen.getByRole('button', { name: /Noman Ali.*Change password/ });
    expect(button.className).toContain('sider-user');
    expect(button.textContent).toBe('NANoman AliChange password');
    fireEvent.click(button);
    expect(screen.getByText('Current password')).toBeTruthy();
  });

  test('collapsed to the rail: the initials alone, the name on hover', () => {
    render(<ChangePassword username='Noman Ali' variant='sider' collapsed />);
    const button = screen.getByRole('button');
    expect(button.textContent).toBe('NA');
    expect(button.getAttribute('title')).toMatch(/Signed in as Noman Ali/);
  });
});

describe('useMediaQuery', () => {
  let listeners;
  let matches;
  beforeEach(() => {
    listeners = [];
    matches = false;
    window.matchMedia = jest.fn(() => ({
      get matches() { return matches; },
      addEventListener: (_, fn) => listeners.push(fn),
      removeEventListener: (_, fn) => { listeners = listeners.filter((l) => l !== fn); },
    }));
  });

  const Probe = () => <span>{useMediaQuery('(max-width: 1366px)') ? 'compact' : 'full'}</span>;

  test('follows the window as it changes', () => {
    render(<Probe />);
    expect(screen.getByText('full')).toBeTruthy();
    matches = true;
    act(() => listeners.forEach((l) => l()));
    expect(screen.getByText('compact')).toBeTruthy();
    expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 1366px)');
  });
});
