export function getCSS(): string {
  return `
:root{--bg:#f0f3f6;--fg:#1f2328;--card:#fff;--muted:#656d76;--border:#d1d9e0;
  --accent:#0969da;--accent-s:#ddf4ff;--ok:#1a7f37;--ok-s:#dafbe1;
  --warn:#9a6700;--warn-s:#fff8c5;--err:#cf222e;--err-s:#ffebe9;
  --purple:#8250df;--sh:0 1px 3px rgba(31,35,40,.06);--sh-h:0 4px 12px rgba(31,35,40,.1);
  --r:12px;--rs:8px}
@media(prefers-color-scheme:dark){:root{--bg:#010409;--fg:#e6edf3;--card:#0d1117;
  --muted:#8b949e;--border:#30363d;--accent:#58a6ff;--accent-s:#0c2d6b;
  --ok:#3fb950;--ok-s:#0b3d1a;--warn:#d29922;--warn-s:#3d2a04;
  --err:#f85149;--err-s:#4c1119;--purple:#bc8cff;
  --sh:0 1px 3px rgba(0,0,0,.24);--sh-h:0 4px 12px rgba(0,0,0,.32)}}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
  color:var(--fg);background:var(--bg);line-height:1.55;min-height:100vh}
main{max-width:1400px;margin:0 auto;padding:1.5rem 1rem 2rem}
a{color:var(--accent)}
.hero{background:linear-gradient(135deg,#0969da 0%,#8250df 100%);color:#fff;
  padding:2.5rem 2rem;text-align:center;margin-bottom:2rem}
@media(prefers-color-scheme:dark){.hero{background:linear-gradient(135deg,#1158a7 0%,#6639ba 100%)}}
.hero h1{font-size:1.8rem;font-weight:700;margin-bottom:.35rem}
.subtitle{font-size:1rem;font-weight:600;opacity:.85;text-align:left}
.subtitle-mid,.subtitle-bottom{font-size:.85rem;font-weight:400;opacity:.82;margin-top:.2rem}
.hero-meta-bar{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1rem;padding-right:90px}
.hero-nav{display:flex;gap:1rem}
.hero-nav-link{color:#fff;opacity:.85;font-size:1rem;font-weight:600;text-decoration:none;border-bottom:1px solid rgba(255,255,255,.4);padding-bottom:.1px;transition:opacity .15s}
.hero-nav-link:hover{opacity:1;border-bottom-color:#fff}
.hero-nav-link{display:inline-flex;align-items:center;gap:.35rem}
.hero-owner-link{color:#fff;text-decoration:none;border-bottom:1px solid rgba(255,255,255,.4);padding-bottom:.1rem;transition:opacity .15s}
.hero-owner-link:hover{opacity:1;border-bottom-color:#fff}
.github-corner svg{position:fixed;top:0;right:0;border:0;z-index:999;fill:#24292f;color:#fff}
.github-corner:hover .octo-arm{animation:octocat-wave 560ms ease-in-out}
@keyframes octocat-wave{0%,100%{transform:rotate(0)}20%,60%{transform:rotate(-25deg)}40%,80%{transform:rotate(10deg)}}
@media(max-width:500px){.github-corner:hover .octo-arm{animation:none}.github-corner .octo-arm{animation:octocat-wave 560ms ease-in-out}}
@media(prefers-color-scheme:dark){.github-corner svg{fill:#58a6ff;color:#010409}}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem;margin-bottom:2rem}
.kpi{background:var(--card);border-radius:var(--r);padding:1.25rem 1rem;text-align:center;
  box-shadow:var(--sh);transition:transform .2s,box-shadow .2s}
.kpi:hover{transform:translateY(-2px);box-shadow:var(--sh-h)}
.kpi-icon{font-size:1.6rem;margin-bottom:.3rem}
.kpi-val{font-size:2rem;font-weight:700;line-height:1.1}
.kpi-lbl{font-size:.85rem;color:var(--muted);margin-top:.15rem}
.kpi-sub{font-size:.75rem;color:var(--muted);margin-top:.15rem}
.charts{display:grid;grid-template-columns:1fr 1fr;gap:1.25rem;margin-bottom:2rem}
.card{background:var(--card);border-radius:var(--r);padding:1.25rem;box-shadow:var(--sh)}
.card h2{font-size:1rem;font-weight:600;margin-bottom:.75rem}
.card-wide{grid-column:1/-1}
.card canvas{display:block;width:100%;max-height:260px}
.card-wide canvas{max-height:340px}
.card-trend canvas{max-height:240px}
.repos-section{margin-bottom:2rem}
.repos-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:.75rem;margin-bottom:1rem}
.repos-toolbar h2{font-size:1.2rem;flex:1}
.toolbar-ctrls{display:flex;gap:.5rem}
#repoFilter,#repoSort{font:inherit;font-size:.85rem;padding:.45rem .7rem;
  border:1px solid var(--border);border-radius:var(--rs);background:var(--card);color:var(--fg)}
#repoFilter{width:220px}
#repoFilter:focus,#repoSort:focus{outline:2px solid var(--accent);outline-offset:-1px}
.table-wrap{overflow-x:auto;border-radius:var(--r);box-shadow:var(--sh)}
.repo-table{width:100%;border-collapse:collapse;background:var(--card);font-size:.85rem}
.repo-table thead tr{border-bottom:2px solid var(--border)}
.repo-table th{padding:.55rem .8rem;text-align:left;font-size:.75rem;text-transform:uppercase;
  letter-spacing:.04em;color:var(--muted);font-weight:600;white-space:nowrap;background:var(--card);position:sticky;top:0;z-index:1}
.repo-table td{padding:.5rem .8rem;border-bottom:1px solid var(--border);vertical-align:middle}
.repo-row:hover>td{background:var(--accent-s)}
.repo-row.expanded>td{background:var(--accent-s)}
.repo-detail-cell{background:var(--bg);padding:1rem 1.25rem}
.th-sortable{cursor:pointer;user-select:none}
.th-sortable:hover{color:var(--accent)}
.th-sortable.sort-active{color:var(--accent)}
.sort-ind{margin-left:.3rem;font-size:.8rem;display:inline-block;min-width:.7rem}
.repo-name-cell{display:flex;align-items:center;gap:.4rem;min-width:180px}
.repo-expand-btn{display:inline-flex;align-items:center;justify-content:center;
  width:1.4rem;height:1.4rem;border:none;background:none;color:var(--muted);
  cursor:pointer;padding:0;flex-shrink:0;font-size:1.1rem;line-height:1}
.repo-expand-btn:hover{color:var(--accent)}
.chev{display:inline-block;transition:transform .2s}
.repo-row.expanded .chev{transform:rotate(90deg)}
.rname{font-weight:600;color:var(--accent);text-decoration:none;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.85rem}
.rname:hover{text-decoration:underline}
.col-muted{color:var(--muted);font-size:.8rem}
.col-num{text-align:right}
.col-date,.col-lines{white-space:nowrap;text-align:right}
.td-lines{text-align:right}.td-lines span{display:block}
.grp-hdr-row{cursor:pointer;user-select:none}
.grp-hdr-cell{padding:.5rem .8rem;font-size:.82rem;font-weight:600;
  background:var(--bg);color:var(--muted);border-bottom:1px solid var(--border)}
.grp-hdr-row:hover .grp-hdr-cell{color:var(--fg);background:var(--border)}
.grp-chevron{display:inline-block;font-size:.75rem;transition:transform .2s;
  color:var(--muted);margin-right:.4rem}
.grp-hdr-row.expanded .grp-chevron{transform:rotate(90deg)}
.grp-count{color:var(--muted);font-size:.8rem;font-weight:400}
.bdg{font-size:.7rem;padding:.15rem .5rem;border-radius:999px;font-weight:500;white-space:nowrap}
.bdg-age{background:var(--border);color:var(--muted)}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1rem;margin-bottom:1rem}
.sg h4{font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-bottom:.4rem}
dl{display:flex;flex-direction:column;gap:.15rem}
.dr{display:flex;justify-content:space-between;font-size:.85rem}
.dr dt{color:var(--muted)}.dr dd{font-weight:600}
.pr-wrap{margin-top:.5rem}.pr-wrap h4{font-size:.85rem;margin-bottom:.5rem}
.pr-tbl{width:100%;border-collapse:collapse;font-size:.8rem}
.pr-tbl th,.pr-tbl td{text-align:left;padding:.35rem .5rem;border-bottom:1px solid var(--border)}
.pr-tbl th{color:var(--muted);font-weight:600;font-size:.75rem;text-transform:uppercase;letter-spacing:.03em}
.add{color:var(--ok);font-weight:600}.del{color:var(--err);font-weight:600}
.repo-count{text-align:center;font-size:.8rem;color:var(--muted);margin-top:.75rem}
.filter-bar{position:sticky;top:0;z-index:10;background:var(--bg);border-bottom:1px solid var(--border);
  box-shadow:0 2px 8px rgba(0,0,0,.08);margin-bottom:0}
.filter-bar-inner{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;
  max-width:1400px;margin:0 auto;padding:.65rem 1rem}
.filter-label{font-size:.85rem;color:var(--muted);font-weight:500;white-space:nowrap}
.filter-btns{display:flex;gap:.4rem;flex-wrap:wrap}
.repos-period-note{font-size:.78rem;color:var(--muted);margin:.25rem 0 .6rem;padding:.3rem .5rem;background:var(--accent-s);border-left:3px solid var(--accent);border-radius:0 var(--rs) var(--rs) 0}
.filter-btn{font:inherit;font-size:.8rem;padding:.3rem .8rem;border:1px solid var(--border);
  border-radius:999px;background:transparent;color:var(--muted);cursor:pointer;transition:all .15s}
.filter-btn:hover{border-color:var(--accent);color:var(--accent)}
.filter-btn.active{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}
.filter-toggle{display:flex;align-items:center;gap:.35rem;font-size:.82rem;color:var(--muted);
  cursor:pointer;white-space:nowrap;margin-left:.75rem;padding-left:.75rem;border-left:1px solid var(--border)}
.filter-toggle input{accent-color:var(--accent);cursor:pointer}
.data-range{opacity:.82;font-size:.88rem}
footer{max-width:1400px;margin:0 auto;padding:1rem;text-align:center;font-size:.8rem;
  color:var(--muted);border-top:1px solid var(--border)}
@media(max-width:640px){
  .charts{grid-template-columns:1fr}
  .hero{padding:1.5rem 1rem}.hero h1{font-size:1.4rem}
  .toolbar-ctrls{flex-direction:column;width:100%}
  #repoFilter{width:100%}
  .col-date,.col-lines{display:none}
}
.repo-picker{position:relative;margin-left:.75rem;padding-left:.75rem;border-left:1px solid var(--border)}
.repo-picker-btn{font:inherit;font-size:.82rem;padding:.3rem .7rem;border:1px solid var(--border);
  border-radius:999px;background:transparent;color:var(--muted);cursor:pointer;
  display:inline-flex;align-items:center;gap:.35rem;transition:all .15s;white-space:nowrap}
.repo-picker-btn:hover{border-color:var(--accent);color:var(--accent)}
.repo-picker-btn.active{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}
.repo-picker-caret{font-size:.65rem;opacity:.7}
.repo-picker-panel{position:absolute;top:calc(100% + .4rem);left:0;z-index:200;
  background:var(--card);border:1px solid var(--border);border-radius:var(--rs);
  box-shadow:var(--sh-h);min-width:240px;max-width:320px}
.repo-picker-toolbar{display:flex;align-items:center;gap:.4rem;padding:.5rem .6rem;
  border-bottom:1px solid var(--border)}
.repo-picker-action{font:inherit;font-size:.75rem;padding:.2rem .55rem;border:1px solid var(--border);
  border-radius:999px;background:transparent;color:var(--muted);cursor:pointer;white-space:nowrap;transition:all .15s}
.repo-picker-action:hover{border-color:var(--accent);color:var(--accent)}
.repo-picker-search{font:inherit;font-size:.8rem;padding:.25rem .5rem;flex:1;min-width:0;
  border:1px solid var(--border);border-radius:var(--rs);background:var(--bg);color:var(--fg)}
.repo-picker-search:focus{outline:2px solid var(--accent);outline-offset:-1px}
.repo-picker-list{max-height:260px;overflow-y:auto;padding:.3rem 0}
.repo-picker-item{display:flex;align-items:center;gap:.45rem;padding:.3rem .75rem;
  font-size:.83rem;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.repo-picker-item:hover{background:var(--accent-s)}
.repo-picker-item input{accent-color:var(--accent);cursor:pointer;flex-shrink:0}
`;
}
