import { copyLink } from './route';

/** "Copy link" for an item header: the address that opens this item for anyone who can see it. */
export default function CopyLink({ view, id, what }: { view: string; id: number; what: string }) {
  return (
    <button
      type="button"
      className="link"
      title="The address of this page: anyone who can see it opens it with the link"
      onClick={() => copyLink(view, id, what)}
    >
      Copy link
    </button>
  );
}
