import { useContext, useEffect, useState } from 'react';
import { api } from '../api';
import { LabCtx, MeCtx } from '../ctx';
import { Modal } from '../lib/ui';
import { todayIso } from '../start/parts';

const LATER = 'psc-profile-later';

/**
 * Accounts made before 0.36 have no email, birth date or department. Once per session, they are asked for them: the email and
 * birth date let a person choose a new password after an admin resets it; the rest is for the lab's records and the calendar.
 */
export default function CompleteProfile() {
  const { me, reload } = useContext(MeCtx),
    { lab } = useContext(LabCtx);
  const [later, setLater] = useState(() => {
    try {
      return !!sessionStorage.getItem(LATER);
    } catch {
      return false;
    }
  });
  const [email, setEmail] = useState(me.email ?? ''),
    [birth, setBirth] = useState(me.birthDate ?? ''),
    [dept, setDept] = useState(me.department ?? ''),
    [sup, setSup] = useState(me.supervisor ?? ''),
    [err, setErr] = useState('');
  const missing = !me.email || !me.birthDate || !me.department;
  // after the questions about ended bookings, never on top of them
  const [clear, setClear] = useState(false);
  useEffect(() => {
    if (!missing || later) return;
    const t = window.setInterval(() => setClear(!document.querySelector('.outcome-scrim')), 1500);
    return () => window.clearInterval(t);
  }, [missing, later]);
  if (!missing || later || !clear) return null;
  const skip = () => {
    try {
      sessionStorage.setItem(LATER, '1');
    } catch {
      /* private window */
    }
    setLater(true);
  };
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    api('/me', 'PATCH', { email, birthDate: birth, department: dept, supervisor: sup })
      .then(reload)
      .catch((x) => setErr(x.message));
  };
  const depts = lab?.departments ?? [];
  return (
    <Modal onClose={skip}>
      <form className="complete-profile pad-x" onSubmit={save}>
        <h2>Complete your profile</h2>
        <p className="mut">
          Your institutional email and birth date let you choose a new password if an admin resets yours. Your birthday
          (day and month) shows in the calendar unless you hide it in your profile.
        </p>
        <div className="grid2">
          <label className="fld">
            <span>Institutional email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="fld">
            <span>Birth date</span>
            <input type="date" max={todayIso()} value={birth} onChange={(e) => setBirth(e.target.value)} />
          </label>
        </div>
        <div className="grid2">
          <label className="fld">
            <span>Department</span>
            {depts.length ? (
              <select value={dept} onChange={(e) => setDept(e.target.value)}>
                <option value="">Choose…</option>
                {depts.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            ) : (
              <input value={dept} onChange={(e) => setDept(e.target.value)} />
            )}
          </label>
          <label className="fld">
            <span>Supervisor</span>
            <input value={sup} onChange={(e) => setSup(e.target.value)} />
          </label>
        </div>
        {err && <p className="err small">{err}</p>}
        <div className="dialog-actions">
          <button type="button" className="link" onClick={skip}>
            Later
          </button>
          <button className="btn" disabled={!email || !birth || !dept.trim()}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
