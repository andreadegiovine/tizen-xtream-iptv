/**
 * The name of one version of a title or channel: its own name when it has one (channels), otherwise its stream id with what the
 * provider's name says it is and the file type: "#1234 · FHD ITA · mkv".
 */
export const streamLabel = (member) =>
  member.name || [`#${member.id}`, member.tags && member.tags.length ? member.tags.join(' ') : '', member.ext || ''].filter(Boolean).join(' · ');
