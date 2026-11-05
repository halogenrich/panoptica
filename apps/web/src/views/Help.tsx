import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';
import guide from '../../../../docs/user-guide.md?raw';
import quick from '../../../../docs/quick-start.md?raw';
import { Seg } from '../lib/ui';

/** Inline markdown: **bold**, *italic*, `code`, [links](url), <sub>/<sup>. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [],
    re = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[(.+?)\]\((.+?)\)|<sub>(.+?)<\/sub>|<sup>(.+?)<\/sup>/g;
  let last = 0,
    m: RegExpExecArray | null,
    k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const [, b, i, c, lt, lu, sub, sup] = m;
    out.push(
      b ? (
        <b key={k++}>{inline(b)}</b>
      ) : i ? (
        <i key={k++}>{inline(i)}</i>
      ) : c ? (
        <code key={k++}>{c}</code>
      ) : lt ? (
        <span key={k++}>{inline(lt)}</span>
      ) : sub ? (
        <sub key={k++}>{sub}</sub>
      ) : (
        <sup key={k++}>{sup}</sup>
      ),
    );
    void lu; // links point to files in the app folder; shown as text
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block = { t: 'h1' | 'h2' | 'h3' | 'p'; text: string } | { t: 'ul' | 'ol'; items: string[] };
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function parse(md: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [],
    list: { t: 'ul' | 'ol'; items: string[] } | null = null;
  const flush = () => {
    if (para.length) blocks.push({ t: 'p', text: para.join(' ') });
    para = [];
    if (list) blocks.push(list);
    list = null;
  };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd(),
      h = /^(#{1,3}) (.*)$/.exec(line),
      ul = /^\s*- (.*)$/.exec(line),
      ol = /^\s*\d+\. (.*)$/.exec(line);
    if (h) {
      flush();
      blocks.push({ t: (['h1', 'h2', 'h3'] as const)[h[1].length - 1], text: h[2] });
    } else if (ul || ol) {
      if (para.length) {
        blocks.push({ t: 'p', text: para.join(' ') });
        para = [];
      }
      const t = ul ? 'ul' : 'ol';
      if (!list || list.t !== t) {
        if (list) blocks.push(list);
        list = { t, items: [] };
      }
      list.items.push((ul ?? ol)![1]);
    } else if (!line.trim()) flush();
    else if (list && /^\s{2,}/.test(raw)) list.items[list.items.length - 1] += ' ' + line.trim();
    else {
      if (list) {
        blocks.push(list);
        list = null;
      }
      para.push(line.trim());
    }
  }
  flush();
  return blocks;
}

/** The user guide (docs/user-guide.md), with a table of contents and a filter. */
export default function Help() {
  const [doc, setDoc] = useState<'quick' | 'guide'>('quick');
  return (
    <>
      <div className="help-tabs">
        <Seg
          value={doc}
          on={setDoc}
          small
          opts={[
            ['quick', 'Quick start'],
            ['guide', 'User guide'],
          ]}
        />
      </div>
      <Doc key={doc} md={doc === 'quick' ? quick : guide} />
    </>
  );
}

function Doc({ md }: { md: string }) {
  const blocks = useMemo(() => parse(md), [md]),
    [q, setQ] = useState(''),
    body = useRef<HTMLDivElement>(null);
  const sections = useMemo(() => {
    // h2 sections with their blocks, for the contents list and the filter
    const out: { title: string; blocks: Block[] }[] = [];
    for (const b of blocks) {
      if (b.t === 'h1') continue;
      if (b.t === 'h2') out.push({ title: b.text, blocks: [b] });
      else if (out.length) out[out.length - 1].blocks.push(b);
      else out.push({ title: '', blocks: [b] });
    }
    return out;
  }, [blocks]);
  const text = (b: Block) => ('text' in b ? b.text : b.items.join(' ')).toLowerCase();
  const shown = q ? sections.filter((s) => s.blocks.some((b) => text(b).includes(q.toLowerCase()))) : sections;
  const jump = (t: string) =>
    document.getElementById('help-' + slug(t))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <div className="help">
      <aside className="help-toc">
        <input type="search" placeholder="Filter the guide" value={q} onChange={(e) => setQ(e.target.value)} />
        <nav>
          {shown
            .filter((s) => s.title)
            .map((s) => (
              <button key={s.title} className="navitem" onClick={() => jump(s.title)}>
                {s.title}
              </button>
            ))}
        </nav>
      </aside>
      <article className="help-body group" ref={body}>
        {!q && blocks[0]?.t === 'h1' && <h2 className="help-title">{blocks[0].text}</h2>}
        {shown.length === 0 && <p className="mut">Nothing in the guide matches “{q}”.</p>}
        {shown.map((s, si) => (
          <Fragment key={si}>
            {s.blocks.map((b, i) => {
              switch (b.t) {
                case 'h2':
                  return (
                    <h3 key={i} id={'help-' + slug(b.text)} className="help-h2">
                      {b.text}
                    </h3>
                  );
                case 'h3':
                  return (
                    <h4 key={i} className="help-h3">
                      {b.text}
                    </h4>
                  );
                case 'p':
                  return <p key={i}>{inline(b.text)}</p>;
                case 'ul':
                  return (
                    <ul key={i}>
                      {b.items.map((x, j) => (
                        <li key={j}>{inline(x)}</li>
                      ))}
                    </ul>
                  );
                case 'ol':
                  return (
                    <ol key={i}>
                      {b.items.map((x, j) => (
                        <li key={j}>{inline(x)}</li>
                      ))}
                    </ol>
                  );
                default:
                  return null;
              }
            })}
          </Fragment>
        ))}
      </article>
    </div>
  );
}
