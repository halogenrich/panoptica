/**
 * The lab's address on the network (0.51): the name IT gave the computer that runs PANOPTICA (panoptica.example.edu), shown on
 * the sign-in screen and used in every copied link. Shared by the server (which decides) and the browser (which shows the
 * address while it is typed).
 */

/** Who can open PANOPTICA: the computer that runs it alone, or every computer on the network. */
export type NetOpen = 'computer' | 'network';

/** The port nobody has to type: 80 for HTTP, 443 for HTTPS. */
export const defaultPort = (https: boolean) => (https ? 443 : 80);

/**
 * An address as people paste it, reduced to the name: "https://Panoptica.Example.edu:8080/x" gives "panoptica.example.edu".
 * The scheme, the port and anything after the name are settings of their own.
 */
export function cleanAddress(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d*$/, '')
    .replace(/\.$/, '');
}

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
/** An IPv4 address, for a lab with a fixed address and no name. */
export const isIp = (s: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s) && s.split('.').every((n) => +n <= 255);

/** What is wrong with an address (already cleaned), or '' when it can be one: a name like panoptica.example.edu, or an IPv4 address. */
export function addressProblem(a: string): string {
  if (!a) return '';
  if (a.length > 253) return 'the address is too long';
  if (isIp(a)) return '';
  if (/^[\d.]+$/.test(a)) return 'this is not a complete address (four numbers, like 10.0.0.12, or a name)';
  if (!a.split('.').every((l) => LABEL.test(l)))
    return 'an address is a name like panoptica.example.edu: letters, digits, hyphens and dots';
  return '';
}

/** Where the lab opens PANOPTICA: its address with the scheme, and the port only when it is not the scheme's own. */
export function labUrl(n: { address: string; port: number; https: boolean }): string {
  if (!n.address) return '';
  return `${n.https ? 'https' : 'http'}://${n.address}${n.port === defaultPort(n.https) ? '' : ':' + n.port}`;
}
