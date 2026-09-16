import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  ListMusic,
  Home,
  Library,
  Search,
  ChevronDown,
  Disc3,
  Star,
  X,
} from "lucide-preact";
import AppShell from "./AppShell.jsx";
import {
  bindMediaSession,
  cyclePlayRepeat,
  getPlayAudio,
  seekTo,
  setPlayShuffle,
  skipTrack,
  startPlayback,
  togglePlay,
} from "../lib/playEngine.js";
import {
  currentPlayTrack,
  readPlaySession,
  setPlayExpanded,
  subscribePlaySession,
} from "../lib/playSession.js";
import {
  bootstrapLibraryFromCache,
  prefetchLibrary,
  writeLibraryCache,
} from "../lib/libraryCache.js";

const RECENT_KEY = "sonozz-play-recent";
