import { describe, expect, it } from 'vitest';
import { buildDoctorReport, canonicalize } from '@openref/core';
import { agentHealthReport, agentResources, readAgentResource } from '../../src/index';
import { orderDocument } from '../mocks/documents';

const mounted = { basePath: '/docs', agent: { llmsTxt: true, mcp: true } };

describe('agentHealthReport', () => {
  it('should withhold a finding about an internal node and count what it withheld', () => {
    // Given a document whose internal operation really does carry a finding, asserted present
    // first: an absent finding and a filter that never ran look the same in the output
    const document = orderDocument();
    const whole = buildDoctorReport(document);
    const internal = whole.findings.filter(
      (finding) => finding.nodeId === 'post-admin-impersonate',
    );
    expect(internal.length).toBeGreaterThan(0);

    // When
    const report = agentHealthReport(document);

    // Then, per the T058 amendment: a drift finding on an internal node is an internal node, and
    // its `subject` names the method and path, so leaving it in would expose the operation the
    // tool list withheld
    expect(report.findings.map((finding) => finding.nodeId)).not.toContain(
      'post-admin-impersonate',
    );
    expect(JSON.stringify(report)).not.toContain('/admin/impersonate');
    expect(report.withheldFindings).toBe(internal.length);
  });

  it('should keep every finding that is not about a withheld node', () => {
    // Given
    const document = orderDocument();
    const whole = buildDoctorReport(document);

    // When
    const report = agentHealthReport(document);

    // Then, a finding about a schema or about the document itself is not about a node at all and
    // is never withheld by this filter
    expect(report.findings.length).toBe(whole.findings.length - report.withheldFindings);
    expect(report.findings.some((finding) => finding.nodeId === undefined)).toBe(true);
  });

  it('should report a score about what it shows rather than about what it hid', () => {
    // Given
    const document = orderDocument();
    const whole = buildDoctorReport(document);

    // When
    const report = agentHealthReport(document);

    // Then, handing back the unfiltered score beside a shorter list would be a figure nothing in
    // the payload supports
    expect(report.withheldFindings).toBeGreaterThan(0);
    expect(report.score).toBeGreaterThan(whole.score);
    expect(Number.isInteger(report.score)).toBe(true);
  });

  it('should keep the score untouched when nothing was withheld', () => {
    // Given a document with no internal node at all, which is every ordinary reference
    const document = orderDocument();
    const bare = {
      ...document,
      nodes: new Map(
        [...document.nodes.entries()].filter(([id]) => id !== 'post-admin-impersonate'),
      ),
    };

    // When
    const report = agentHealthReport(bare);

    // Then
    expect(report.withheldFindings).toBe(0);
    expect(report.score).toBe(buildDoctorReport(bare).score);
  });
});

describe('readAgentResource', () => {
  it('should refuse a uri no resource carries, saying which fact that is', () => {
    // Given
    const document = orderDocument();

    // When
    const read = readAgentResource('openref://nothing', document, mounted);

    // Then, "no such resource" and "the host turned it off" are two facts a caller acts on
    // differently, so the refusal names which one this is
    expect(read.ok).toBe(false);
    expect(read.ok ? '' : read.reason).toContain('no resource with the uri');
  });

  it('should serialize the health report through the canonical form', () => {
    // Given, per CLAUDE.md: a payload a consumer caches and diffs goes through `canonicalize`,
    // so two reads of one unchanged document are byte identical without a JSON aware differ
    const document = orderDocument();

    // When
    const read = readAgentResource('openref://health', document, mounted);

    // Then
    expect(read.ok ? read.contents.mimeType : '').toBe('application/json');
    expect(read.ok ? read.contents.text : '').toBe(canonicalize(agentHealthReport(document)));
  });

  it('should list one resource per readable uri, with none listed that cannot be read', () => {
    // Given, a listed resource that answers nothing is the class of defect this repository calls
    // a declared but never held promise
    const document = orderDocument();

    // When
    const reads = agentResources(mounted.agent).map((resource) =>
      readAgentResource(resource.uri, document, mounted),
    );

    // Then
    expect(reads.length).toBe(3);
    expect(reads.every((read) => read.ok)).toBe(true);
  });

  it('should neither list nor read the two text files while the host has them off', () => {
    // Given, found by the second blind review of `T058`: the HTTP address answered 403 and the
    // resource served the file, so "off" was off on one surface only
    const document = orderDocument();
    const off = { basePath: '/docs', agent: { llmsTxt: false, mcp: true } };

    // When
    const listed = agentResources(off.agent).map((resource) => resource.uri);
    const index = readAgentResource('openref://llms.txt', document, off);
    const full = readAgentResource('openref://llms-full.txt', document, off);

    // Then, with the presence half first: the same listing carries all three while they are on
    expect(agentResources(mounted.agent)).toHaveLength(3);
    expect(listed).toEqual(['openref://health']);
    expect([index.ok, full.ok]).toEqual([false, false]);
    expect(index.ok ? '' : index.reason).toContain('agent: { llmsTxt: false }');
  });
});
