/** The name of one version of a title or channel ("#123 · mkv" when the provider gives none). */
export const streamLabel = (member) => member.name || `#${member.id}${member.ext ? ` · ${member.ext}` : ''}`;
