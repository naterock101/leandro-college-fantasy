/**
 * The tokens and the rules more than one component uses. Everything else is a
 * `css` export on the component that owns it.
 *
 * Why the styles are split this way, given four agents are about to add
 * sections to this page at the same time: one 200-line template string is one
 * merge conflict per agent, and it is also the file where a rule outlives the
 * markup it was written for, because nothing puts the two next to each other.
 * Keeping a component's rules in the component's own file makes the styles as
 * disjoint as the components, and makes a dead rule visible - it is sitting
 * directly under the JSX that stopped using it.
 *
 * What stays here is what genuinely has more than one caller: the tokens, the
 * page frame, the table primitives, and the `.gow` row shape that the live
 * block, games of the week, the head-to-head list and the timeline all use.
 * Putting one of those in a component would mean another component's layout
 * silently depended on that component being on screen.
 *
 * Rejected: a CSS framework, and CSS modules. The first is a runtime
 * dependency in a repo whose first ground rule is that there are none. The
 * second is not - Next compiles it away - but it would put the styles in a
 * third place, `.module.css` files next to the components, for no gain over a
 * string the component already owns.
 */

export const base = `
    :root{--ink:#0D1520;--panel:#141F2E;--rule:#2A3D53;--chalk:#E9EEF4;--muted:#7E8FA3;--amber:#F0A83C;--teal:#49B49E;--red:#D9697F}
    body{margin:0;background:var(--ink);color:var(--chalk);
      font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
    .wrap{max-width:760px;margin:0 auto;padding:20px 14px 70px}
    .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
    .muted{color:var(--muted)} .sm{font-size:12px} .r{text-align:right}
    .err{color:#C4566B}
    header{border-bottom:2px solid var(--rule);padding-bottom:14px;margin-bottom:14px}
    h1{font-family:Georgia,serif;font-size:26px;line-height:1.15;letter-spacing:-.02em;margin:8px 0 6px}
    .brand{display:flex;align-items:center;gap:14px}
    .brand h1{margin:0 0 3px}
    .mark{flex-shrink:0;height:130px;width:auto;display:block}
    h2{font-family:Georgia,serif;font-size:19px;margin:26px 0 2px;display:flex;
      justify-content:space-between;align-items:baseline}
    .cw{font-family:ui-monospace,Menlo,monospace;font-size:9px;letter-spacing:.1em;
      text-transform:uppercase;color:var(--muted)}
    .asof{font-size:12px;color:var(--muted);margin:0 0 10px}
    .caption{font-size:11px;line-height:1.5;color:var(--muted);margin:9px 0 0;opacity:.85}
    table{width:100%;border-collapse:collapse}
    th{font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);
      font-family:ui-monospace,Menlo,monospace;font-weight:600;padding:0 5px 7px;border-bottom:1px solid var(--rule)}
    td{padding:11px 5px;border-bottom:1px solid rgba(42,61,83,.55)}
    .rank{font-family:ui-monospace,Menlo,monospace;color:var(--muted);width:22px;font-size:12px}
    .pts{font-family:ui-monospace,Menlo,monospace;font-size:18px;font-weight:700;color:var(--amber)}
    .tier{font-family:ui-monospace,Menlo,monospace;font-size:9px;font-weight:700;
      width:15px;text-align:center;border-radius:3px;padding:2px 0;flex-shrink:0}
    .tier.p4{background:rgba(73,180,158,.18);color:var(--teal)}
    .tier.g5{background:rgba(240,168,60,.15);color:var(--amber)}
    .gow{display:flex;gap:9px;align-items:baseline;padding:8px 0;font-size:13px;
      border-bottom:1px solid rgba(42,61,83,.4)}
    .gow .mu{flex:1} .gow .d{width:44px;flex-shrink:0;font-size:11px}
    .at{color:var(--muted)}
    .stakes{color:var(--amber);font-weight:700;font-size:12px;width:30px;text-align:right;flex-shrink:0}
    .self{color:var(--amber);font-style:normal;font-size:11px;white-space:nowrap}
    /* an opponent nobody drafted has no owner to name, and a bare team name
       beside "Nathan's ..." otherwise reads as missing data */
    .undr{color:var(--muted);opacity:.65;font-size:11px;white-space:nowrap}
    .score{width:44px;text-align:right;flex-shrink:0}
    .filters{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
    .seg{display:flex;border:1px solid var(--rule);border-radius:6px;overflow:hidden}
    .seg button{background:transparent;border:0;border-right:1px solid var(--rule);color:var(--muted);
      padding:7px 12px;font-size:12.5px;cursor:pointer;font-family:inherit}
    .seg button:last-child{border-right:0}
    .seg button.on{background:var(--chalk);color:var(--ink);font-weight:600}
`;
