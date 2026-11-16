import { describe, expect, it } from 'vitest';
import { addressProblem, cleanAddress, defaultPort, isIp, labUrl } from './network';

describe('the lab’s address', () => {
  it('is reduced to the name, whatever was pasted', () => {
    expect(cleanAddress(' https://Panoptica.Example.edu:8080/#/batches/3 ')).toBe('panoptica.example.edu');
    expect(cleanAddress('panoptica.example.edu.')).toBe('panoptica.example.edu');
    expect(cleanAddress('http://labserver/')).toBe('labserver');
    expect(cleanAddress('10.0.0.12:3000')).toBe('10.0.0.12');
    expect(cleanAddress('')).toBe('');
  });
  it('is a name or an IPv4 address', () => {
    for (const ok of ['', 'panoptica.example.edu', 'labserver', 'lab-2.chem.example.edu', '10.0.0.12'])
      expect(addressProblem(ok)).toBe('');
    for (const bad of [
      'lab server',
      '-lab.example.edu',
      'lab_.example.edu',
      '10.0.0',
      '300.1.1.1',
      'a..b',
      'é.example',
    ])
      expect(addressProblem(bad)).not.toBe('');
    expect(isIp('300.1.1.1')).toBe(false);
    expect(addressProblem('a'.repeat(254))).toMatch(/too long/);
  });
  it('gives the address people open, without the port nobody types', () => {
    expect(labUrl({ address: 'panoptica.example.edu', port: 443, https: true })).toBe('https://panoptica.example.edu');
    expect(labUrl({ address: 'panoptica.example.edu', port: 80, https: false })).toBe('http://panoptica.example.edu');
    expect(labUrl({ address: 'labserver', port: 3000, https: false })).toBe('http://labserver:3000');
    expect(labUrl({ address: 'labserver', port: 8443, https: true })).toBe('https://labserver:8443');
    expect(labUrl({ address: '', port: 80, https: false })).toBe('');
    expect(defaultPort(true)).toBe(443);
    expect(defaultPort(false)).toBe(80);
  });
});
