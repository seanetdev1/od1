/**
 * The release in the header (2026-11-15): the server's, from /health, with
 * the screens' own beside it - amber when they differ. It read "v1.0.0" on
 * every install, package.json's never-bumped version.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { versionChip } from 'functions/appVersion';

jest.mock('functions/installInfo', () => ({ getInstallInfo: jest.fn() }));

describe('versionChip', () => {
  test('the server and the screens on one release: that release', () => {
    expect(versionChip('1.2.100', '1.2.100')).toEqual({ text: 'v1.2.100', mismatch: false, lines: ['Version v1.2.100'] });
  });

  test('on two releases: the server\'s, flagged, both named', () => {
    const chip = versionChip('1.2.99', '1.2.100');
    expect(chip.text).toBe('v1.2.99');
    expect(chip.mismatch).toBe(true);
    expect(chip.lines[0]).toBe('Server v1.2.99, screens v1.2.100 - two different releases.');
  });

  test('a server from before the fix says 1.0.0 - next to real screens, that is a mismatch too', () => {
    expect(versionChip('1.0.0', '1.2.100').mismatch).toBe(true);
  });

  test('a local run is dev, never a mismatch', () => {
    expect(versionChip('dev', '')).toEqual({ text: 'dev', mismatch: false, lines: ['Version dev'] });
    expect(versionChip('1.2.100', 'dev').mismatch).toBe(false);
    expect(versionChip('dev', '1.2.100').lines).toEqual(['Server dev, screens v1.2.100']);
  });

  test('a test build (a commit, not a tag) is shown as it is', () => {
    expect(versionChip('a1b2c3d', 'a1b2c3d').text).toBe('a1b2c3d');
  });

  test('nothing known: no chip', () => {
    expect(versionChip('', '')).toBeNull();
    expect(versionChip(undefined, undefined)).toBeNull();
  });
});

describe('BuildVersionChip', () => {
  const { getInstallInfo } = require('functions/installInfo');
  const BuildVersionChip = require('Components/Shared/BuildVersionChip').default;
  const load = (info, screens) => {
    process.env.NEXT_PUBLIC_APP_VERSION = screens;
    getInstallInfo.mockResolvedValue(info);
    return BuildVersionChip;
  };
  afterEach(() => { delete process.env.NEXT_PUBLIC_APP_VERSION; });

  test('shows the release the server reports', async () => {
    const Chip = load({ version: '1.2.100', installId: 'odyssey-CL', database: 'up' }, '1.2.100');
    render(<Chip />);
    await waitFor(() => expect(screen.getByTestId('version-chip')).toHaveTextContent('v1.2.100'));
    expect(screen.getByTestId('version-chip')).not.toHaveClass('is-mismatch');
  });

  test('amber when the two images are on different releases', async () => {
    const Chip = load({ version: '1.2.99', database: 'up' }, '1.2.100');
    render(<Chip />);
    await waitFor(() => expect(screen.getByTestId('version-chip')).toHaveClass('is-mismatch'));
  });

  test('nothing while the server has not answered', async () => {
    const Chip = load(null, '1.2.100');
    const { container } = render(<Chip />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });
});
