import repeating from "repeating";
import { format } from "date-fns";
import chalk from "chalk";
import stripColor from "strip-ansi";
import through from "through";
import { width as termwidth } from "window-size";
import { EOL as newline } from "node:os";

type Line = [number, number];
type Timeout = NodeJS.Timeout;

export type GnomonOptions = {
  /**
   * @default "H:i:s.u O
   */
  format?: string;
  /**
   * @default undefined
   */
  low?: number;
  /**
   * @default undefined
   */
  medium?: number;
  /**
   * @default undefined
   */
  high?: number;
  /**
   * ???
   */
  ignoreBlank?: boolean;
  /**
   * ???
   */
  realTime?: number;
  /**
   * @default elapsed-line
   */
  type?: "elapsed-line" | "elapsed-total" | "absolute";
};

const ansi = {
  prefix: "\x1b[",
  up: "A",
  clearLine: "0G",
};

const nanoPow = Math.pow(10, 9);

function durationToSeconds(dur: Line) {
  const [seconds, nanoseconds] = dur;
  return seconds + nanoseconds / nanoPow;
}

const space = " ";
const sAbbr = "s";
const places = 4;
const maxDisplaySecondsDigits = 4;

function formatDuration(dur: Line) {
  return durationToSeconds(dur).toFixed(places) + sAbbr;
}

const start = process.hrtime();
let elapsedLine: Line = [0, 0];
let elapsedTotal: Line = [0, 0];
let elapsedSeconds = durationToSeconds(elapsedLine);
let lap = start;
let last = start;

function tick(resetLine: Line | boolean) {
  const now = process.hrtime();
  if (resetLine) {
    lap = now;
    elapsedLine = process.hrtime(last);
  } else {
    elapsedLine = process.hrtime(lap);
  }
  elapsedSeconds = durationToSeconds(elapsedLine);
  elapsedTotal = process.hrtime(start);
  last = process.hrtime();
}

const nullString = "";
function padFor(s = "", max: number) {
  const l = s.length;
  return l < max ? repeating(max - l, space) : nullString;
}

const bar = space + chalk.reset.inverse(" ") + space;
const totalLabel = "Total";

function gnomon(opts?: GnomonOptions) {
  const {
    high,
    medium,
    low = -1,
    format: fmt = "H:i:s.u O",
    type = "elapsed-line",
    realTime = 500,
    ignoreBlank,
  } = opts ?? {};
  // const fmt = opts.format || "H:i:s.u O";
  // const type = opts.type || "elapsed-line";

  const stampers = {
    "elapsed-line": function () {
      return formatDuration(elapsedLine);
    },
    "elapsed-total": function () {
      return formatDuration(elapsedTotal);
    },
    absolute: function () {
      return format(new Date(), fmt);
    },
  };

  let maxDurLength: number;
  let blank: string;
  let maxLineLength: number;

  if (type === "absolute") {
    maxDurLength = stampers.absolute().length;
  } else {
    maxDurLength = maxDisplaySecondsDigits + places + 2; // dot and 's'
  }
  maxDurLength = Math.max(maxDurLength, totalLabel.length);
  blank = repeating(maxDurLength, space) + bar;
  maxLineLength = termwidth - stripColor(blank).length;

  const stampLine = (stamp: string, line: string): string => {
    const len = line ? stripColor(line).length : 0;

    if (len > maxLineLength) {
      return (
        stamp +
        line.slice(0, maxLineLength) +
        newline +
        stampLine(blank, line.slice(maxLineLength))
      );
    }

    return stamp + line + newline;
  };

  /**
   * Provides color formatted stamp based on elapsed time and thresholds set in options
   * @param stamp
   * @param value no idea, probably not needed, is always 0
   * @returns
   */
  const colorStamp = (stamp: any) => {
    if (high && elapsedSeconds >= high) {
      return chalk.reset.red(stamp);
    }
    if (medium && elapsedSeconds >= medium) {
      return chalk.reset.yellow(stamp);
    }
    return chalk.reset.green(stamp);
  };

  const createStamp = stampers[type];

  /**
   * ??? creates our format for output with time aligned, bar, and the output
   * @returns
   */
  function createFormattedStamp() {
    const stamp = createStamp();
    return padFor("", maxDurLength) + colorStamp(stamp) + bar;
  }

  let lastLine: any;
  let overwrite: any;
  let autoUpdate: Timeout;

  function scheduleAutoUpdate(stream: any) {
    autoUpdate = setTimeout(function () {
      tick(false);
      stream.queue(overwrite + stampLine(createFormattedStamp(), lastLine));
      scheduleAutoUpdate(stream);
    }, realTime);
  }

  function setLastLine(line: Line) {
    lastLine = line;
    overwrite =
      ansi.prefix +
      (~~(lastLine.length / maxLineLength) + 1) +
      ansi.up +
      ansi.prefix +
      ansi.clearLine;
  }

  let feed: any;

  if (realTime) {
    // TODO remove last here since it's not used?
    // not sure why we have feed defined twice
    feed = function (stream: any, line: any, last: any) {
      feed = function (stream: any, line: any, last: any) {
        tick(false);
        stream.queue(overwrite + stampLine(createFormattedStamp(), lastLine));
        tick(true);

        if (autoUpdate) {
          clearTimeout(autoUpdate);
        }

        scheduleAutoUpdate(stream);
        setLastLine(line);

        if (!last && elapsedSeconds > low) {
          stream.queue(stampLine(blank, line));
        }
      };
      stream.queue(stampLine(blank, line));
      setLastLine(line);
      scheduleAutoUpdate(stream);
    };
  } else {
    feed = function (stream: any, line: Line) {
      feed = function (stream: any, line: Line, last?: boolean) {
        tick(true);

        if (!last && elapsedSeconds > low) {
          stream.queue(stampLine(createFormattedStamp(), lastLine));
        }

        lastLine = line;
      };
      lastLine = line;
    };
  }

  let onData: any;

  if (ignoreBlank) {
    onData = function (line: Line) {
      if (line) {
        feed(this, line);
      }
    };
  } else {
    onData = function (line: Line) {
      feed(this, line);
    };
  }

  return through(onData, function end() {
    feed(this, "", true);
    this.queue(
      stampLine(blank, "") +
        padFor(totalLabel, maxDurLength) +
        totalLabel +
        bar +
        formatDuration(elapsedTotal) +
        newline
    );
    if (autoUpdate) {
      clearTimeout(autoUpdate);
    }
  });
}

export { gnomon };
