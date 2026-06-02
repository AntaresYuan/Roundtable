/* ============================================================================
   Roundtable — Design System documentation page (ds.jsx)
   Reads the SAME tokens the product uses (src/tokens.css) and showcases the
   real primitives. Light/dark toggle reflects live token values.
   ============================================================================ */
const { useState, useEffect, useMemo } = React;

const ROLES = window.RT.ROLE_COLORS;
const SAMPLE = {
  pm:    { agentId: 'pm', role: 'planner', displayName: 'PM', color: '#938b7c', avatar: '👑', pm: true },
  arch:  { agentId: 'arch', role: 'architect', displayName: 'Nova', color: ROLES.architect, avatar: 'N' },
  plan:  { agentId: 'plan', role: 'planner', displayName: 'Atlas', color: ROLES.planner, avatar: 'A' },
  impl:  { agentId: 'impl', role: 'implementer', displayName: 'Beam', color: ROLES.implementer, avatar: 'B' },
  rev:   { agentId: 'rev', role: 'reviewer', displayName: 'Vera', color: ROLES.reviewer, avatar: 'V' },
  fix:   { agentId: 'fix', role: 'fixer', displayName: 'Mendez', color: ROLES.fixer, avatar: 'M' },
};

/* read a live CSS var off <html> */
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function LogoMark({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      {[[20, 8], [9, 13], [31, 13], [13, 24], [27, 24]].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="2.4" fill="var(--accent)" opacity={i === 0 ? 1 : 0.55} />
      ))}
      <ellipse cx="20" cy="25" rx="13.5" ry="6.2" fill="color-mix(in oklab, var(--accent) 70%, #000 30%)" />
      <ellipse cx="20" cy="22.5" rx="13.5" ry="6.2" fill="var(--accent)" />
      <ellipse cx="17" cy="20.8" rx="8" ry="3" fill="#fff" opacity=".35" />
    </svg>
  );
}

function MiniFigure({ color, size = 46 }) {
  const d = size, bw = d * 1.5, bh = d * 1.12;
  return (
    <div style={{ position: 'relative', width: bw, height: d * 0.86 + bh, margin: '0 auto' }}>
      <div style={{ position: 'absolute', left: '50%', bottom: -4, transform: 'translateX(-50%)', width: bw * 0.9, height: 11,
        borderRadius: '50%', background: 'rgba(0,0,0,.2)', filter: 'blur(5px)' }} />
      <div style={{ position: 'absolute', left: '50%', bottom: 0, transform: 'translateX(-50%)', width: bw, height: bh,
        borderRadius: `${bw * 0.72}px ${bw * 0.72}px ${bw * 0.42}px ${bw * 0.42}px / ${bh * 0.92}px ${bh * 0.92}px ${bw * 0.42}px ${bw * 0.42}px`,
        background: `linear-gradient(158deg, color-mix(in oklab, ${color} 74%, #fff 26%), ${color} 56%, color-mix(in oklab, ${color} 82%, #000 18%))`,
        boxShadow: `inset 0 ${d * 0.16}px ${d * 0.3}px color-mix(in oklab,#fff 34%,transparent), 0 8px 16px -8px rgba(0,0,0,.45)` }} />
      <div style={{ position: 'absolute', left: '50%', top: 0, transform: 'translateX(-50%)', width: d, height: d, borderRadius: '50%',
        background: `radial-gradient(circle at 36% 28%, color-mix(in oklab, ${color} 26%, #fff), color-mix(in oklab, ${color} 42%, var(--surface)) 48%, color-mix(in oklab, ${color} 64%, #000 10%))`,
        boxShadow: `inset ${d * 0.1}px -${d * 0.12}px ${d * 0.2}px rgba(0,0,0,.14), 0 ${d * 0.06}px ${d * 0.14}px rgba(0,0,0,.28)` }} />
    </div>
  );
}

/* ---- layout helpers ------------------------------------------------------ */
function Section({ id, n, title, intro, children }) {
  return (
    <section id={id} style={{ marginBottom: 64, scrollMarginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
        <span className="mono" style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>{n}</span>
        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-.015em' }}>{title}</h2>
      </div>
      {intro && <p style={{ margin: '0 0 22px', fontSize: 14.5, color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: 660 }}>{intro}</p>}
      {children}
    </section>
  );
}
function Card({ title, children, style }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)',
      boxShadow: 'var(--shadow-card)', padding: 20, ...style }}>
      {title && <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase',
        color: 'var(--text-faint)', marginBottom: 14 }}>{title}</div>}
      {children}
    </div>
  );
}
function Grid({ min = 220, gap = 16, children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`, gap }}>{children}</div>;
}

/* ---- swatch -------------------------------------------------------------- */
function Swatch({ varName, label, ring }) {
  const [hex, setHex] = useState('');
  useEffect(() => { setHex(cssVar(varName)); });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0, background: `var(${varName})`,
        boxShadow: ring ? 'inset 0 0 0 1px var(--border)' : 'none' }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>{varName} · {hex}</div>
      </div>
    </div>
  );
}

/* ---- type specimen ------------------------------------------------------- */
function TypeRow({ label, family, size, weight, sample, tracking, mono }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 18, padding: '14px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ width: 130, flexShrink: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{label}</div>
        <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-faint)' }}>{size}px · {weight}</div>
      </div>
      <div style={{ fontFamily: family, fontSize: size, fontWeight: weight, letterSpacing: tracking || 0, lineHeight: 1.2,
        color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sample}</div>
    </div>
  );
}

/* ---- buttons (mirror product styles) ------------------------------------- */
const btnPrimary = { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 15px', borderRadius: 'var(--r-sm)',
  border: 'none', background: 'var(--accent)', color: '#fff', font: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const btnGhost = { ...btnPrimary, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' };
const btnSoft = { ...btnPrimary, background: 'var(--surface-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' };

/* ============================================================================ */
function DS() {
  const [theme, setTheme] = useState('light');
  useEffect(() => {
    const r = document.documentElement;
    r.dataset.aesthetic = 'neutral'; r.dataset.theme = theme; r.dataset.density = 'balanced';
  }, [theme]);

  const nav = [
    ['brand', 'Brand'], ['color', 'Color'], ['agents', 'Agent palette'], ['type', 'Typography'],
    ['space', 'Spacing & form'], ['icons', 'Icons'], ['components', 'Components'], ['motion', 'Motion'],
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* side nav */}
      <aside style={{ width: 230, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--surface)',
        position: 'sticky', top: 0, height: '100vh', display: 'flex', flexDirection: 'column', padding: '24px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <LogoMark size={26} />
          <span style={{ fontWeight: 700, fontSize: 16 }}>Roundtable</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 22 }}>Design System · v1</div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {nav.map(([id, label]) => (
            <a key={id} href={'#' + id} style={{ textDecoration: 'none', color: 'var(--text-muted)', fontSize: 13.5,
              padding: '7px 10px', borderRadius: 'var(--r-sm)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.color = 'var(--text)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}>{label}</a>
          ))}
        </nav>
        <div style={{ marginTop: 'auto' }}>
          <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} style={{ ...btnGhost, width: '100%', justifyContent: 'center' }}>
            <Icon name={theme === 'light' ? 'moon' : 'sun'} size={15} /> {theme === 'light' ? 'Dark' : 'Light'} preview
          </button>
        </div>
      </aside>

      {/* content */}
      <main style={{ flex: 1, padding: '52px 56px', maxWidth: 1040 }}>
        <header style={{ marginBottom: 56 }}>
          <h1 style={{ margin: '0 0 10px', fontSize: 40, fontWeight: 700, letterSpacing: '-.025em' }}>Roundtable Design System</h1>
          <p style={{ margin: 0, fontSize: 16, color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: 680 }}>
            The visual language of a calm multi-agent workbench. The room is warm paper and a single clay accent;
            <b> the agents are the only saturated color</b> — every participant owns a hue that carries through their
            messages, artifacts, and presence at the table.
          </p>
          <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
            {['Calm, document-like', 'Per-agent color ownership', 'IBM Plex', 'Warm clay accent'].map((t) => (
              <span key={t} style={{ fontSize: 12.5, padding: '5px 12px', borderRadius: 999, background: 'var(--surface-2)',
                border: '1px solid var(--border)', color: 'var(--text-muted)' }}>{t}</span>
            ))}
          </div>
        </header>

        {/* BRAND */}
        <Section id="brand" n="01" title="Brand" intro="The mark is the rounded table seen in perspective, with five seats around it — the product in one glyph. It tints with the accent so it works on any surface.">
          <Grid min={200}>
            <Card title="Logomark">
              <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '8px 0' }}>
                <LogoMark size={56} /><LogoMark size={32} /><LogoMark size={22} />
              </div>
            </Card>
            <Card title="Lockup">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <LogoMark size={30} /><span style={{ fontWeight: 700, fontSize: 20, letterSpacing: '-.01em' }}>Roundtable</span>
              </div>
            </Card>
            <Card title="On accent">
              <div style={{ display: 'grid', placeItems: 'center', height: 64, borderRadius: 10, background: 'var(--accent)' }}>
                <span style={{ fontWeight: 700, fontSize: 18, color: '#fff' }}>Roundtable</span>
              </div>
            </Card>
          </Grid>
        </Section>

        {/* COLOR */}
        <Section id="color" n="02" title="Color" intro="Warm bone surfaces and warm-gray text in both themes. One clay accent carries all primary actions and active states. Status hues are borrowed from the agent palette so the whole system agrees.">
          <Grid min={260}>
            <Card title="Surfaces">
              <div style={{ display: 'grid', gap: 13 }}>
                <Swatch varName="--bg" label="Background" ring />
                <Swatch varName="--surface" label="Surface" ring />
                <Swatch varName="--surface-2" label="Surface 2" ring />
                <Swatch varName="--surface-3" label="Surface 3" ring />
                <Swatch varName="--border" label="Border" ring />
                <Swatch varName="--border-strong" label="Border strong" ring />
              </div>
            </Card>
            <Card title="Text">
              <div style={{ display: 'grid', gap: 13 }}>
                <Swatch varName="--text" label="Text" />
                <Swatch varName="--text-muted" label="Text muted" />
                <Swatch varName="--text-faint" label="Text faint" />
                <Swatch varName="--pm" label="Facilitator (muted)" />
              </div>
            </Card>
            <Card title="Accent & status">
              <div style={{ display: 'grid', gap: 13 }}>
                <Swatch varName="--accent" label="Accent (clay)" />
                <Swatch varName="--ok" label="OK / done" />
                <Swatch varName="--run" label="Running / live" />
                <Swatch varName="--warn" label="Warning / review" />
                <Swatch varName="--bad" label="Error / failed" />
              </div>
            </Card>
          </Grid>
        </Section>

        {/* AGENTS */}
        <Section id="agents" n="03" title="Agent palette" intro="Five evenly-spaced jewel tones — one per role. Every agent carries its color prop into a 1px left border on its messages and artifacts, an avatar ring, and its role-tag. The facilitator (PM) is a muted warm gray and speaks rarely.">
          <Grid min={150} gap={14}>
            {[SAMPLE.arch, SAMPLE.plan, SAMPLE.impl, SAMPLE.rev, SAMPLE.fix].map((a) => (
              <Card key={a.agentId} style={{ textAlign: 'center', padding: 18 }}>
                <MiniFigure color={a.color} size={44} />
                <div style={{ marginTop: 14 }}><RoleTag agent={a} /></div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 8 }}>{a.color}</div>
              </Card>
            ))}
          </Grid>
          <div style={{ marginTop: 16 }}>
            <Card title="Ownership in context">
              <div style={{ display: 'grid', gap: 10 }}>
                {[SAMPLE.plan, SAMPLE.impl, SAMPLE.rev].map((a) => (
                  <div key={a.agentId} style={{ display: 'flex', gap: 12, alignItems: 'flex-start',
                    borderLeft: `1.5px solid ${alpha(a.color, 55)}`, paddingLeft: 13 }}>
                    <Avatar agent={a} size={30} />
                    <div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span style={{ fontWeight: 600, fontSize: 13.5 }}>{a.displayName}</span><RoleTag agent={a} />
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>A message group carries the owner’s hue on its left edge.</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </Section>

        {/* TYPE */}
        <Section id="type" n="04" title="Typography" intro="One family, three expressions: IBM Plex Sans for UI, IBM Plex Serif for agent prose in the document aesthetic, and IBM Plex Mono for code, file paths, and metadata.">
          <Card>
            <TypeRow label="Display" family="var(--font-ui)" size={40} weight={700} tracking="-.025em" sample="Build it at the table" />
            <TypeRow label="Title" family="var(--font-ui)" size={24} weight={700} tracking="-.015em" sample="Here’s the plan" />
            <TypeRow label="Heading" family="var(--font-ui)" size={18} weight={600} sample="Waitlist landing page" />
            <TypeRow label="Body" family="var(--font-ui)" size={15} weight={400} sample="The user never reads raw terminal output." />
            <TypeRow label="Prose (serif)" family="var(--font-prose)" size={16} weight={400} sample="Scaffolded the landing page and wired the form." />
            <TypeRow label="Label" family="var(--font-ui)" size={12} weight={600} sample="MEMBERS · TASKS · WORKFLOW" />
            <TypeRow label="Mono / meta" family="var(--font-mono)" size={13} weight={500} sample="app/api/waitlist/route.ts · v2" />
          </Card>
        </Section>

        {/* SPACING */}
        <Section id="space" n="05" title="Spacing, radius & elevation" intro="A calm, roomy rhythm. Radii are soft; elevation is a faint two-layer shadow that keeps cards floating gently off warm paper.">
          <Grid min={240}>
            <Card title="Radius">
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end' }}>
                {[['--r-sm', 'sm'], ['--r-card', 'card'], ['--r-chip', 'chip']].map(([v, l]) => (
                  <div key={v} style={{ textAlign: 'center' }}>
                    <div style={{ width: 60, height: 60, background: 'var(--surface-2)', border: '1px solid var(--border)',
                      borderRadius: `var(${v})` }} />
                    <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-faint)', marginTop: 6 }}>{l}</div>
                  </div>
                ))}
              </div>
            </Card>
            <Card title="Elevation">
              <div style={{ display: 'flex', gap: 16 }}>
                <div style={{ flex: 1, height: 60, borderRadius: 'var(--r-card)', background: 'var(--surface)',
                  border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)' }} />
                <div style={{ flex: 1, height: 60, borderRadius: 'var(--r-card)', background: 'var(--surface)',
                  boxShadow: 'var(--shadow-pop)' }} />
              </div>
              <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-faint)', marginTop: 8 }}>card · pop</div>
            </Card>
            <Card title="Inputs & chips">
              <div style={{ display: 'grid', gap: 10 }}>
                <input placeholder="Message the table…" style={{ padding: '9px 12px', borderRadius: 'var(--r-sm)',
                  border: '1px solid var(--border)', background: 'var(--surface-2)', font: 'inherit', fontSize: 13, color: 'var(--text)' }} />
                <div style={{ display: 'flex', gap: 7 }}>
                  <Chip color="var(--accent)" active>active</Chip><Chip>default</Chip>
                </div>
              </div>
            </Card>
          </Grid>
        </Section>

        {/* ICONS */}
        <Section id="icons" n="06" title="Iconography" intro="A single line set at 1.7px stroke, round caps. Calm and uniform — icons never carry color except to echo an agent or a status.">
          <Card>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(86px, 1fr))', gap: 6 }}>
              {['layers', 'sparkle', 'code', 'eye', 'door', 'wrench', 'rocket', 'check', 'edit', 'clip', 'pin', 'send',
                'at', 'plus', 'search', 'expand', 'play', 'pause', 'replay', 'chevron', 'sun', 'moon', 'flask', 'x'].map((n) => (
                <div key={n} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '12px 4px',
                  borderRadius: 'var(--r-sm)', color: 'var(--text-muted)' }}>
                  <Icon name={n} size={20} />
                  <span className="mono" style={{ fontSize: 9.5, color: 'var(--text-faint)' }}>{n}</span>
                </div>
              ))}
            </div>
          </Card>
        </Section>

        {/* COMPONENTS */}
        <Section id="components" n="07" title="Components" intro="The building blocks, shown live. Each is driven by the same tokens and the per-agent color prop.">
          <Grid min={250}>
            <Card title="Avatars">
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                {Object.values(SAMPLE).map((a) => <Avatar key={a.agentId} agent={a} size={34} />)}
              </div>
            </Card>
            <Card title="Role tags">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {[SAMPLE.arch, SAMPLE.plan, SAMPLE.impl, SAMPLE.rev, SAMPLE.fix].map((a) => <RoleTag key={a.agentId} agent={a} />)}
              </div>
            </Card>
            <Card title="Status">
              <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
                {['pending', 'running', 'completed', 'failed'].map((s) => (
                  <div key={s} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7 }}>
                    <StatusGlyph status={s} size={20} />
                    <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>{s}</span>
                  </div>
                ))}
              </div>
            </Card>
            <Card title="Buttons">
              <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
                <button style={btnPrimary}><Icon name="play" size={14} /> Primary</button>
                <button style={btnGhost}>Ghost</button>
                <button style={btnSoft}><Icon name="wrench" size={13} /> Soft</button>
              </div>
            </Card>
            <Card title="Participant">
              <div style={{ display: 'flex', gap: 22, justifyContent: 'center' }}>
                <div style={{ textAlign: 'center' }}><MiniFigure color={SAMPLE.impl.color} size={40} />
                  <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 8 }}>Beam</div></div>
                <div style={{ textAlign: 'center' }}><MiniFigure color={cssVar('--pm') || '#938b7c'} size={40} />
                  <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 8 }}>PM</div></div>
              </div>
            </Card>
            <Card title="Door (breakout)">
              <div style={{ display: 'grid', placeItems: 'center', padding: '4px 0' }}>
                <div style={{ width: 50, height: 72, borderRadius: '9px 9px 3px 3px', background: 'linear-gradient(168deg, var(--surface), var(--surface-2))',
                  border: '1.5px solid var(--border-strong)', position: 'relative', boxShadow: '0 10px 22px -12px rgba(0,0,0,.5)' }}>
                  <div style={{ position: 'absolute', inset: '7px 8px', borderRadius: '5px 5px 2px 2px', border: '1px solid var(--border)' }} />
                  <div style={{ position: 'absolute', right: 10, top: '50%', width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)' }} />
                </div>
              </div>
            </Card>
          </Grid>
          <div style={{ marginTop: 16 }}>
            <Card title="Artifact card (file)">
              <ArtifactRenderer art={window.RT.ARTIFACTS.landing} agents={{ atlas: SAMPLE.plan }} onOpen={() => {}} />
            </Card>
          </div>
        </Section>

        {/* MOTION */}
        <Section id="motion" n="08" title="Motion" intro="Motion is gentle and meaningful: agents bob softly when idle, lift and glow when they speak, and a single dashed beam shows who is contributing. Transitions use ease-out cubic curves around 150–400ms.">
          <Grid min={220}>
            <Card title="Idle bob"><div className="rt-bob" style={{ width: 'fit-content', margin: '0 auto' }}><MiniFigure color={SAMPLE.arch.color} size={40} /></div></Card>
            <Card title="Speaking glow"><div className="rt-glow" style={{ width: 60, height: 60, borderRadius: '50%', margin: '8px auto',
              '--glow-c': SAMPLE.impl.color, background: SAMPLE.impl.color }} /></Card>
            <Card title="Thinking shimmer"><div style={{ display: 'grid', placeItems: 'center', height: 60 }}>
              <span className="rt-shimmer" style={{ fontSize: 15, fontStyle: 'italic' }}>thinking…</span></div></Card>
          </Grid>
        </Section>

        <footer style={{ borderTop: '1px solid var(--border)', paddingTop: 22, color: 'var(--text-faint)', fontSize: 12.5 }}>
          Roundtable Design System · generated from <span className="mono">src/tokens.css</span> + live primitives · IBM Plex
        </footer>
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('ds-root')).render(<DS />);
