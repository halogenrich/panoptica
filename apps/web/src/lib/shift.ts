/** Whether Shift is held right now (keyboard or the last click), for hidden options such as the funny settings. */
let held = false;
if (typeof window !== 'undefined') {
  const set = (e: KeyboardEvent | MouseEvent) => {
    held = e.shiftKey;
  };
  window.addEventListener('keydown', set, true);
  window.addEventListener('keyup', set, true);
  window.addEventListener('pointerdown', set as any, true);
  window.addEventListener('click', set, true);
  window.addEventListener('blur', () => {
    held = false;
  });
}
export const shiftHeld = () => held;
