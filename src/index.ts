import repeating from "repeating";
import { format } from "date-fns";
import chalk from "chalk";
import stripColor from "strip-ansi";
import through from "through";
import { width as termwidth } from "window-size";
import { EOL as newline } from "node:os";

type Line = [number, number];
type Options = {
  /**
   * @default "H:i:s.u O
   */
  format?: string;
  /**
   * @default undefined
   */
  high?: number;
  /**
   * ???
   */
  ignoreBlank?: boolean;
  /**
   * @default undefined
   */
  medium?: number;
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
  return dur[0] + dur[1] / nanoPow;
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

function gnomon(opts: Options) {
  opts = opts || {};
  const fmt = opts.format || "H:i:s.u O";
  const type = opts.type || "elapsed-line";

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

  function stampLine(stamp: string, line: string): string {
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
  }

  let colorStamp: any;
  const high = opts.high;
  const medium = opts.medium;
  if (medium && high) {
    colorStamp = function (stamp: any) {
      const seconds = durationToSeconds(elapsedLine);
      if (seconds >= high) {
        return chalk.reset.red(stamp);
      }
      if (seconds >= medium) {
        return chalk.reset.yellow(stamp);
      }
      return chalk.reset.green(stamp);
    };
  } else if (medium) {
    colorStamp = function (stamp: any) {
      if (durationToSeconds(elapsedLine) >= medium) {
        return chalk.reset.yellow(stamp);
      }
      return chalk.reset.green(stamp);
    };
  } else if (high) {
    colorStamp = function (stamp: any) {
      if (durationToSeconds(elapsedLine) >= high) {
        return chalk.reset.red(stamp);
      }
      return chalk.reset.green(stamp);
    };
  } else {
    colorStamp = function (stamp: any) {
      return chalk.reset(stamp);
    };
  }

  const createStamp = stampers[type];

  function createFormattedStamp(text = "", value = 0) {
    const stamp = createStamp();
    return padFor(text, maxDurLength) + colorStamp(stamp, value) + bar;
  }

  type Timeout = NodeJS.Timeout;

  let lastLine: any;
  let overwrite: any;
  let autoUpdate: Timeout;
  function scheduleAutoUpdate(stream: any) {
    autoUpdate = setTimeout(function () {
      tick(false);
      stream.queue(overwrite + stampLine(createFormattedStamp(), lastLine));
      scheduleAutoUpdate(stream);
    }, opts.realTime);
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
  if (opts.realTime) {
    feed = function (stream: any, line: any, last: any) {
      feed = function (stream: any, line: any, last: any) {
        tick(false);
        stream.queue(overwrite + stampLine(createFormattedStamp(), lastLine));
        tick(true);
        if (autoUpdate) clearTimeout(autoUpdate);
        scheduleAutoUpdate(stream);
        setLastLine(line);
        if (!last) stream.queue(stampLine(blank, line));
      };
      stream.queue(stampLine(blank, line));
      setLastLine(line);
      scheduleAutoUpdate(stream);
    };
  } else {
    feed = function (stream: any, line: Line, last: any) {
      feed = function (stream: any, line: Line, last: any) {
        tick(true);
        if (!last) stream.queue(stampLine(createFormattedStamp(), lastLine));
        lastLine = line;
      };
      lastLine = line;
    };
  }

  let onData: any;
  if (opts.ignoreBlank) {
    onData = function (line: Line) {
      if (line) feed(this, line);
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
    if (autoUpdate) clearTimeout(autoUpdate);
  });
}

export { gnomon };
