export const Dir = Object.freeze({ UP: 'up', DOWN: 'down', LEFT: 'left', RIGHT: 'right' });

const move = (index) => ({ type: 'move', index });
const exit = (dir) => ({ type: 'exit', dir });

/**
 * Navigation models work on data indices, not on DOM geometry, so they keep working with
 * virtualized lists where off-screen elements do not exist.
 */
export class GridModel {
  constructor({ columns, getCount }) {
    this.columns = columns;
    this.getCount = getCount;
  }

  navigate(dir, index) {
    const cols = this.columns;
    const count = this.getCount();
    const row = Math.floor(index / cols);
    const lastRow = Math.floor((count - 1) / cols);
    switch (dir) {
      case Dir.LEFT:
        return index % cols === 0 ? exit(dir) : move(index - 1);
      case Dir.RIGHT:
        return index % cols === cols - 1 || index >= count - 1 ? exit(dir) : move(index + 1);
      case Dir.UP:
        return row === 0 ? exit(dir) : move(index - cols);
      case Dir.DOWN:
        return row >= lastRow ? exit(dir) : move(Math.min(index + cols, count - 1));
      default:
        return exit(dir);
    }
  }
}

export class ListModel {
  constructor({ orientation = 'horizontal', getCount }) {
    this.orientation = orientation;
    this.getCount = getCount;
  }

  navigate(dir, index) {
    const count = this.getCount();
    const [prev, next] =
      this.orientation === 'horizontal' ? [Dir.LEFT, Dir.RIGHT] : [Dir.UP, Dir.DOWN];
    if (dir === prev) return index > 0 ? move(index - 1) : exit(dir);
    if (dir === next) return index < count - 1 ? move(index + 1) : exit(dir);
    return exit(dir);
  }
}
