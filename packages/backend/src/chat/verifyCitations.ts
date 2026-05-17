export function verifyCitations(text: string, toolResults: any[]) {
  // Collect all valid fact_ids from tool results
  const validFactIds = new Set<string>();
  for (const tr of toolResults) {
    const output = tr?.output ?? tr;

    if (output && Array.isArray(output.total_fact_ids)) {
      output.total_fact_ids.forEach((id: string) => validFactIds.add(String(id)));
    } else if (output && Array.isArray(output.all_fact_ids)) {
      output.all_fact_ids.forEach((id: string) => validFactIds.add(String(id)));
    } else if (output && Array.isArray(output.fact_ids)) {
      output.fact_ids.forEach((id: string) => validFactIds.add(String(id)));
    }
  }

  // Find citations in text: [src: shopify, fact_ids: f_1, f_2]
  const citationRegex = /\[src: (shopify|meta_ads|shiprocket), fact_ids: ([^\]]+)\]/g;
  
  const verified = text.replace(citationRegex, (match, source, idsString) => {
    const ids = idsString.split(',').map((s: string) => s.trim());
    const validIds = ids.filter((id: string) => validFactIds.has(id));
    
    if (validIds.length === 0) {
      // If all hallucinated, we could strip it completely or flag it
      return ''; 
    }
    return `[src: ${source}, fact_ids: ${validIds.join(', ')}]`;
  });

  return { verified: verified.trim() };
}
