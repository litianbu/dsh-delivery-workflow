// Client half of the delivery-workflow bundle.
//
// Data: GET /delivery/api/state?workspace=...   Actions: POST /delivery/api/action
// Paths resolve against document.baseURI so a sub-path deployment still works.
//
// Layout, as agreed: one collapsed row per delivery showing the current stage,
// the actions that stage allows, and an explicit "mark done" that is the only
// way a delivery leaves the active list. A delivery stays open and re-runnable
// until then, so no progress bar and no automatic closing.
window.__ModuleLoader__.load({
  id: '@local/delivery-workflow',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useMemo } = React

    const DEFAULT_WORKSPACE = '/Users/runzhili/Desktop/biomap-delivery'
    const STORAGE_KEY = 'dsh.delivery.workspace'

    function api(path) {
      const rel = String(path).replace(/^\/+/, '')
      if (typeof document === 'undefined') return '/' + rel
      return new URL(rel, document.baseURI).pathname
    }

    const STAGE_LABEL = {
      intake: '需求',
      develop: '开发',
      verify: '验证',
      build: '构建',
      deploy: '部署',
      closed: '已完成',
    }

    const ACTIONS_BY_STAGE = {
      intake: ['verify'],
      develop: ['verify'],
      verify: ['verify', 'build'],
      build: ['verify', 'build', 'deploy'],
      deploy: ['verify', 'build', 'deploy'],
      closed: [],
    }

    const ACTION_LABEL = { verify: '验证', build: '构建', deploy: '部署' }

    const B = '1px solid var(--dsw-alias-border-default, rgba(127,127,127,0.30))'
    const Bs = '1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,0.20))'
    const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace'

    const css = {
      page: { height: '100%', overflow: 'auto', position: 'relative', font: 'inherit', color: 'inherit' },
      wrap: { maxWidth: 900, margin: '0 auto', padding: '24px 30px 90px' },
      head: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 18 },
      h1: { fontSize: 17, margin: 0, fontWeight: 600 },
      sub: { fontSize: 12, opacity: 0.5 },
      spacer: { flex: 1 },
      btn: { font: 'inherit', fontSize: 12, padding: '6px 13px', borderRadius: 7, border: B, background: 'var(--dsw-alias-bg-raised, transparent)', color: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' },
      primary: { font: 'inherit', fontSize: 12, padding: '6px 13px', borderRadius: 7, border: '1px solid var(--dsw-alias-accent, #2563eb)', background: 'var(--dsw-alias-accent, #2563eb)', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: 500 },
      small: { font: 'inherit', fontSize: 12, padding: '4px 10px', borderRadius: 6, border: B, background: 'transparent', color: 'inherit', cursor: 'pointer' },
      ghost: { font: 'inherit', fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid transparent', background: 'transparent', color: 'inherit', opacity: 0.6, cursor: 'pointer' },
      label: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, opacity: 0.55, margin: '24px 0 10px' },
      row: { border: Bs, borderRadius: 9, padding: '11px 14px', marginBottom: 9, background: 'var(--dsw-alias-bg-raised, transparent)' },
      rowHead: { display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', flexWrap: 'wrap' },
      id: { fontFamily: mono, fontSize: 12, opacity: 0.65 },
      title: { fontSize: 13.5, fontWeight: 600 },
      chip: { fontSize: 11, padding: '1px 8px', borderRadius: 999, border: B, opacity: 0.85 },
      body: { marginTop: 11, paddingTop: 11, borderTop: Bs },
      meta: { display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, opacity: 0.7, marginBottom: 10 },
      code: { fontFamily: mono, fontSize: 11.5, padding: '1px 6px', borderRadius: 5, background: 'var(--dsw-alias-bg-subtle, rgba(127,127,127,0.12))' },
      actions: { display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 },
      hint: { fontSize: 11.5, opacity: 0.45, marginLeft: 'auto' },
      empty: { fontSize: 12, opacity: 0.5, padding: '14px 0' },
      err: { border: '1px solid rgba(220,38,38,0.4)', background: 'rgba(220,38,38,0.08)', borderRadius: 8, padding: '10px 13px', fontSize: 12, margin: '12px 0' },
      ok: { border: '1px solid rgba(22,163,74,0.4)', background: 'rgba(22,163,74,0.08)', borderRadius: 8, padding: '10px 13px', fontSize: 12, margin: '12px 0' },
      veil: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.42)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 56, zIndex: 20 },
      modal: { width: 'min(620px, calc(100% - 48px))', background: 'var(--dsw-alias-bg-overlay, #fff)', color: 'inherit', borderRadius: 12, border: B, padding: '20px 22px', boxShadow: '0 18px 48px rgba(0,0,0,0.28)' },
      step: { display: 'flex', gap: 13, padding: '13px 0', borderTop: Bs },
      no: { flex: '0 0 21px', height: 21, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 11, background: 'var(--dsw-alias-accent, #2563eb)', color: '#fff' },
      field: { display: 'flex', alignItems: 'center', gap: 8, border: B, borderRadius: 7, padding: '7px 10px', fontSize: 12, marginBottom: 7 },
      input: { flex: 1, minWidth: 0, font: 'inherit', fontSize: 12, color: 'inherit', background: 'transparent', border: 0, outline: 'none' },
      note: { fontSize: 11, opacity: 0.5, lineHeight: 1.6 },
      foot: { display: 'flex', gap: 8, alignItems: 'center', paddingTop: 16 },
    }

    const S = (base, extra) => Object.assign({}, base, extra)
