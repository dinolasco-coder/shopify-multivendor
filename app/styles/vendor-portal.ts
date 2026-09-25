/** Shared Nexus-like styles for the seller portal */
export const vendorPortalStyles = `
  .sx-shell {
    --sx-bg: #f6f6f7;
    --sx-card: #ffffff;
    --sx-border: #e4e5e7;
    --sx-text: #1a1a1a;
    --sx-muted: #6d7175;
    --sx-accent: #1a1a1a;
    min-height: 100vh;
    display: flex;
    background: var(--sx-bg);
    color: var(--sx-text);
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .sx-sidebar {
    width: 220px;
    flex-shrink: 0;
    background: #fff;
    border-right: 1px solid var(--sx-border);
    display: flex;
    flex-direction: column;
    padding: 16px 12px;
  }
  .sx-brand { padding: 8px 10px 20px; }
  .sx-brand__name { font-weight: 700; font-size: 15px; margin: 0; }
  .sx-brand__sub { margin: 4px 0 0; font-size: 12px; color: var(--sx-muted); word-break: break-all; }
  .sx-nav { display: flex; flex-direction: column; gap: 4px; flex: 1; }
  .sx-nav a {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 12px; border-radius: 8px; text-decoration: none;
    color: var(--sx-text); font-size: 14px; font-weight: 600;
  }
  .sx-nav a:hover { background: #f1f2f3; }
  .sx-nav a.is-active { background: #e4e5e7; }
  .sx-nav__bottom { margin-top: auto; padding-top: 12px; border-top: 1px solid var(--sx-border); }
  .sx-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .sx-top {
    background: #fff; border-bottom: 1px solid var(--sx-border);
    padding: 14px 24px; display: flex; justify-content: space-between; align-items: center; gap: 12px;
  }
  .sx-top__user { display: flex; align-items: center; gap: 10px; }
  .sx-avatar {
    width: 36px; height: 36px; border-radius: 999px; background: #1a1a1a; color: #fff;
    display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px;
  }
  .sx-top__name { font-weight: 700; font-size: 14px; margin: 0; }
  .sx-top__email { margin: 0; font-size: 12px; color: var(--sx-muted); }
  .sx-badge {
    display: inline-flex; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600;
  }
  .sx-badge.ok { background: #e4f7e9; color: #0d6b2d; }
  .sx-badge.warn { background: #fff4d6; color: #8a6d00; }
  .sx-badge.bad { background: #fbeae9; color: #8e1f0b; }
  .sx-content { padding: 24px; max-width: 1100px; width: 100%; margin: 0 auto; box-sizing: border-box; }
  .sx-title { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 4px; }
  .sx-sub { margin: 0 0 20px; color: var(--sx-muted); font-size: 14px; }
  .sx-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 20px; }
  .sx-metric {
    background: var(--sx-card); border: 1px solid var(--sx-border); border-radius: 12px;
    padding: 16px 18px; text-decoration: none; color: inherit; display: block;
  }
  .sx-metric__label { margin: 0 0 8px; font-size: 13px; color: var(--sx-muted); }
  .sx-metric__value { margin: 0; font-size: 24px; font-weight: 700; }
  .sx-panel {
    background: var(--sx-card); border: 1px solid var(--sx-border); border-radius: 12px;
    padding: 18px; margin-bottom: 16px;
  }
  .sx-panel__head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; }
  .sx-panel__title { margin: 0; font-size: 16px; font-weight: 700; }
  .sx-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 8px; }
  .sx-btn {
    display: inline-flex; align-items: center; justify-content: center;
    border: 1px solid #c9cccf; background: #fff; color: #202223;
    border-radius: 10px; padding: 12px 16px; font-size: 15px; font-weight: 700;
    text-decoration: none; cursor: pointer;
  }
  .sx-btn--primary { background: #1a1a1a; color: #fff; border-color: #1a1a1a; }
  .sx-btn--danger { color: #8e1f0b; border-color: #e0b3b0; }
  .sx-btn--lg { padding: 16px 20px; font-size: 17px; min-width: 160px; }
  .sx-btn:disabled { opacity: 0.6; cursor: default; }
  .sx-link { color: #2c6ecb; text-decoration: none; font-weight: 600; font-size: 13px; }
  .sx-table { width: 100%; border-collapse: collapse; }
  .sx-table th {
    text-align: left; font-size: 12px; font-weight: 600; color: var(--sx-muted);
    padding: 12px 14px; border-bottom: 1px solid var(--sx-border); background: #fafbfb;
  }
  .sx-table td { padding: 14px; border-bottom: 1px solid #ececec; vertical-align: top; font-size: 14px; }
  .sx-table tr:last-child td { border-bottom: none; }
  .sx-primary { font-weight: 700; margin: 0 0 2px; }
  .sx-secondary { margin: 0; color: var(--sx-muted); font-size: 12px; }
  .sx-empty { padding: 28px 12px; text-align: center; color: var(--sx-muted); }
  .sx-banner { margin-bottom: 14px; padding: 12px 14px; border-radius: 10px; font-size: 14px; }
  .sx-banner.info { background: #eaf4ff; color: #004299; }
  .sx-banner.ok { background: #e4f7e9; color: #0d6b2d; }
  .sx-banner.err { background: #fbeae9; color: #8e1f0b; }
  .sx-tabs { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
  .sx-tab {
    border: none; background: transparent; padding: 8px 14px; border-radius: 8px;
    font-size: 13px; font-weight: 600; color: var(--sx-muted); cursor: pointer;
  }
  .sx-tab.is-active { background: #e4e5e7; color: var(--sx-text); }
  .sx-search {
    display: flex; align-items: center; gap: 8px; border: 1px solid #c9cccf;
    border-radius: 10px; background: #fff; padding: 10px 12px; margin-bottom: 12px;
  }
  .sx-search input { border: none; outline: none; width: 100%; font-size: 14px; background: transparent; }
  .sx-mobile-nav { display: none; }
  @media (max-width: 860px) {
    .sx-shell { flex-direction: column; }
    .sx-sidebar { width: 100%; border-right: none; border-bottom: 1px solid var(--sx-border); padding: 12px; }
    .sx-nav { flex-direction: row; flex-wrap: wrap; }
    .sx-nav__bottom { border-top: none; margin-top: 0; padding-top: 0; width: 100%; }
    .sx-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .sx-content { padding: 16px; }
    .sx-table-wrap { overflow-x: auto; }
    .sx-table { min-width: 640px; }
  }
`;
