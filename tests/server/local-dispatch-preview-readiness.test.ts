import { describe, expect, it } from 'vitest';
import { previewReadinessIssues } from '../../src/server/local-dispatch.js';

describe('previewReadinessIssues', () => {
  it('rejects Tailwind-dependent React previews', () => {
    const source = `
import React from 'react';

export default function PricingPage() {
  return <main className="min-h-screen bg-slate-50 px-8 py-12">Pricing</main>;
}
`;

    expect(previewReadinessIssues('app/pricing.tsx', source)).toContain(
      'Replace Tailwind/utility className styling with inline styles or a <style> element because the preview iframe does not load Tailwind CSS.',
    );
  });

  it('rejects external component imports in iframe previews', () => {
    const source = `
import React from 'react';
import { Check } from 'lucide-react';

export default function PricingPage() {
  return <Check />;
}
`;

    expect(previewReadinessIssues('app/pricing.tsx', source)).toContain(
      'Remove unsupported imports: lucide-react. The preview runtime only provides React.',
    );
  });

  it('rejects class names without local CSS', () => {
    const source = `
import React from 'react';

export default function PricingPage() {
  return <main className="pricing-page">Pricing</main>;
}
`;

    expect(previewReadinessIssues('app/pricing.tsx', source)).toContain(
      'Every className in a preview file needs matching CSS in a <style> element, or should be replaced with inline styles.',
    );
  });

  it('rejects TSX syntax that Babel would fail to render', () => {
    const source = `
import React from 'react';

export default function LensRankingPage() {
  return (
    <select>
      <option value="all">All</option>
      <option value="wide">Wide (<35mm)</option>
    </select>
  );
}
`;

    expect(previewReadinessIssues('app/lens-ranking.tsx', source)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Fix TSX syntax error'),
        expect.stringContaining('numeric literal'),
      ]),
    );
  });

  it('accepts self-contained styled React previews', () => {
    const source = `
import React from 'react';

export default function PricingPage() {
  return (
    <main style={{ minHeight: '100vh', background: '#f8fafc', padding: 32 }}>
      <h1>Choose your plan</h1>
    </main>
  );
}
`;

    expect(previewReadinessIssues('app/pricing.tsx', source)).toEqual([]);
  });

  it('accepts local CSS declared in the component', () => {
    const source = `
import React from 'react';

export default function PricingPage() {
  return (
    <>
      <style>{'.pricing-page { min-height: 100vh; background: #f8fafc; padding: 32px; }'}</style>
      <main className="pricing-page">
        <h1>Choose your plan</h1>
      </main>
    </>
  );
}
`;

    expect(previewReadinessIssues('app/pricing.tsx', source)).toEqual([]);
  });
});
