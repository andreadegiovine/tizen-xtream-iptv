import { faHouse } from '@fortawesome/free-solid-svg-icons/faHouse';
import { faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons/faMagnifyingGlass';
import { faGear } from '@fortawesome/free-solid-svg-icons/faGear';
import { faServer } from '@fortawesome/free-solid-svg-icons/faServer';
import { faXmark } from '@fortawesome/free-solid-svg-icons/faXmark';
import { faStar } from '@fortawesome/free-solid-svg-icons/faStar';
import { faCheck } from '@fortawesome/free-solid-svg-icons/faCheck';
import { faHourglassHalf } from '@fortawesome/free-solid-svg-icons/faHourglassHalf';
import { faPlay } from '@fortawesome/free-solid-svg-icons/faPlay';
import { faPause } from '@fortawesome/free-solid-svg-icons/faPause';
import { faRotateRight } from '@fortawesome/free-solid-svg-icons/faRotateRight';
import { faBackward } from '@fortawesome/free-solid-svg-icons/faBackward';
import { faForward } from '@fortawesome/free-solid-svg-icons/faForward';
import { faExpand } from '@fortawesome/free-solid-svg-icons/faExpand';
import { faClosedCaptioning } from '@fortawesome/free-solid-svg-icons/faClosedCaptioning';
import { faChevronDown } from '@fortawesome/free-solid-svg-icons/faChevronDown';
import { faUser } from '@fortawesome/free-solid-svg-icons/faUser';
import { faHeart } from '@fortawesome/free-solid-svg-icons/faHeart';
import { faEye } from '@fortawesome/free-solid-svg-icons/faEye';
import { faClapperboard } from '@fortawesome/free-solid-svg-icons/faClapperboard';
import { faClock } from '@fortawesome/free-solid-svg-icons/faClock';
import { faTableCells } from '@fortawesome/free-solid-svg-icons/faTableCells';
import { faClockRotateLeft } from '@fortawesome/free-solid-svg-icons/faClockRotateLeft';
import { faLayerGroup } from '@fortawesome/free-solid-svg-icons/faLayerGroup';
import { faLightbulb } from '@fortawesome/free-solid-svg-icons/faLightbulb';
import { faPen } from '@fortawesome/free-solid-svg-icons/faPen';
import { faTrash } from '@fortawesome/free-solid-svg-icons/faTrash';
import { faPlus } from '@fortawesome/free-solid-svg-icons/faPlus';
import { faStop } from '@fortawesome/free-solid-svg-icons/faStop';
import { faEyeSlash } from '@fortawesome/free-solid-svg-icons/faEyeSlash';

// Font Awesome Free (CC BY 4.0 / SIL OFL): only the icons listed here end up in the bundle.
// They are inlined as SVG, so there are no font files to ship or load on the TV.
const ICONS = {
  home: faHouse,
  search: faMagnifyingGlass,
  settings: faGear,
  provider: faServer,
  close: faXmark,
  star: faStar,
  check: faCheck,
  hourglass: faHourglassHalf,
  play: faPlay,
  pause: faPause,
  resume: faRotateRight,
  backward: faBackward,
  forward: faForward,
  aspect: faExpand,
  subtitles: faClosedCaptioning,
  chevron: faChevronDown,
  user: faUser,
  clock: faClock,
  heart: faHeart,
  seen: faEye,
  trailer: faClapperboard,
  all: faTableCells,
  continue: faClockRotateLeft,
  categories: faLayerGroup,
  suggestions: faLightbulb,
  edit: faPen,
  remove: faTrash,
  add: faPlus,
  refresh: faRotateRight,
  stop: faStop,
  hidden: faEyeSlash,
};

export const iconNames = Object.keys(ICONS);

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Inline SVG icon that takes the current text color. `name` is a key of ICONS. */
export function icon(name, className = '') {
  const def = ICONS[name];
  if (!def) throw new Error(`Unknown icon: ${name}`);
  const [width, height, , , path] = def.icon;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', `icon icon-${name}${className ? ` ${className}` : ''}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const shape = document.createElementNS(SVG_NS, 'path');
  shape.setAttribute('d', Array.isArray(path) ? path.join(' ') : path);
  shape.setAttribute('fill', 'currentColor');
  svg.appendChild(shape);
  return svg;
}
