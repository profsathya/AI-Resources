/**
 * Remark plugin for rendering Mermaid diagrams at build time
 *
 * This plugin processes Mermaid code blocks in MDX files and replaces them
 * with inline SVGs. It generates both light and dark themed versions to
 * support theme switching without client-side JavaScript rendering.
 *
 * @module remark-mermaid
 * @see https://github.com/processing/p5.js-website/issues/168
 */

import { visit } from 'unist-util-visit';
import { JSDOM } from 'jsdom';

// Mermaid requires a DOM environment - we use JSDOM to provide this
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  runScripts: 'dangerously',
});

// Make the DOM available globally for Mermaid
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;

// Dynamic import of mermaid after DOM is set up
let mermaidModule = null;

async function getMermaid() {
  if (!mermaidModule) {
    const { default: mermaid } = await import('mermaid');
    mermaidModule = mermaid;

    // Initialize with default configuration
    mermaidModule.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    });
  }
  return mermaidModule;
}

/**
 * Renders a Mermaid diagram to SVG with a specific theme
 *
 * @param {string} code - The Mermaid diagram code
 * @param {string} id - Unique identifier for the diagram
 * @param {'default'|'dark'|'forest'|'neutral'} theme - Mermaid theme name
 * @returns {Promise<string>} The rendered SVG string
 */
async function renderMermaidToSvg(code, id, theme = 'default') {
  const mermaid = await getMermaid();

  // Reinitialize with the desired theme
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme: theme,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    themeVariables: theme === 'dark' ? {
      primaryColor: '#1f2937',
      primaryTextColor: '#f3f4f6',
      primaryBorderColor: '#4b5563',
      lineColor: '#9ca3af',
      secondaryColor: '#374151',
      tertiaryColor: '#1f2937',
      background: '#111827',
    } : undefined,
  });

  try {
    const { svg } = await mermaid.render(id, code);
    return svg;
  } catch (error) {
    console.error(`Error rendering Mermaid diagram (${id}):`, error.message);
    // Return a fallback error display
    return `<div class="mermaid-error">
      <p>Error rendering diagram</p>
      <pre>${escapeHtml(code)}</pre>
    </div>`;
  }
}

/**
 * Escapes HTML special characters
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Adds accessibility attributes to SVG
 * @param {string} svg - The SVG string
 * @param {string} title - Title for the diagram
 * @returns {string} SVG with accessibility attributes
 */
function addAccessibility(svg, title) {
  // Add role="img" and aria-label if not present
  if (!svg.includes('role="img"')) {
    svg = svg.replace('<svg', `<svg role="img" aria-label="${escapeHtml(title)}"`);
  }
  return svg;
}

/**
 * Extracts the title from a Mermaid diagram
 * @param {string} code - Mermaid diagram code
 * @returns {string} The diagram title or a default
 */
function extractTitle(code) {
  const titleMatch = code.match(/title:\s*(.+)/);
  if (titleMatch) {
    return titleMatch[1].trim();
  }

  // Try to extract from diagram type
  const typeMatch = code.match(/^(classDiagram|flowchart|sequenceDiagram|stateDiagram|erDiagram|gantt|pie|journey)/m);
  if (typeMatch) {
    return `${typeMatch[1]} diagram`;
  }

  return 'Mermaid diagram';
}

/**
 * The main remark plugin function
 *
 * @returns {Function} Transformer function for remark
 */
export function remarkMermaid() {
  return async (tree, file) => {
    const nodesToProcess = [];
    let diagramCounter = 0;

    // First pass: collect all mermaid code blocks
    visit(tree, 'code', (node, index, parent) => {
      if (node.lang === 'mermaid') {
        nodesToProcess.push({
          node,
          index,
          parent,
          id: diagramCounter++
        });
      }
    });

    // Second pass: render all diagrams
    for (const { node, index, parent, id } of nodesToProcess) {
      const code = node.value;
      const title = extractTitle(code);
      const baseId = `mermaid-${file?.basename?.replace(/\./g, '-') || 'diagram'}-${id}`;

      // Render both light and dark versions
      const [lightSvg, darkSvg] = await Promise.all([
        renderMermaidToSvg(code, `${baseId}-light`, 'default'),
        renderMermaidToSvg(code, `${baseId}-dark`, 'dark'),
      ]);

      // Add accessibility to both SVGs
      const accessibleLightSvg = addAccessibility(lightSvg, `${title} (light theme)`);
      const accessibleDarkSvg = addAccessibility(darkSvg, `${title} (dark theme)`);

      // Create the HTML wrapper with both themed versions
      const html = `
<figure class="mermaid-diagram" data-diagram-id="${baseId}">
  <div class="mermaid-light" aria-hidden="false">
    ${accessibleLightSvg}
  </div>
  <div class="mermaid-dark" aria-hidden="true">
    ${accessibleDarkSvg}
  </div>
  <figcaption class="sr-only">${escapeHtml(title)}</figcaption>
</figure>`.trim();

      // Replace the code block with our rendered HTML
      parent.children[index] = {
        type: 'html',
        value: html,
      };
    }

    return tree;
  };
}

export default remarkMermaid;
