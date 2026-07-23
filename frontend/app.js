import { createApp, ref, reactive, computed } from "vue";

const DEV_WS_URL = "ws://localhost:3000/ws";
const PROD_WS_URL = "wss://planning-poker-backend-ymq7.onrender.com/ws";
const wsUrl =
  location.hostname === "localhost" ? DEV_WS_URL : PROD_WS_URL;

const ROOM_ID_REGEX = /^[a-z0-9]{4,32}(-[a-z0-9]{4,32})*$/;

const DECKS = {
  fibonacci: {
    cards: ["0", "1", "2", "3", "5", "8", "13", "?", "\u2615"],
    order: ["0", "1", "2", "3", "5", "8", "13"],
    numeric: true,
  },
  tshirt: {
    cards: ["XS", "S", "M", "L", "XL", "?", "\u2615"],
    order: ["XS", "S", "M", "L", "XL"],
    numeric: false,
  },
};
const DEFAULT_DECK_KEY = "fibonacci";


function parseRoomParam() {
  const raw = new URLSearchParams(location.search).get("room");
  if (raw === null) return { present: false, valid: false, roomId: null };
  const valid = ROOM_ID_REGEX.test(raw);
  return { present: true, valid, roomId: valid ? raw : null };
}

function generateRoomId() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const seg1 = Array.from(bytes.slice(0, 4))
    .map((b) => chars[b % 36])
    .join("");
  const seg2 = Array.from(bytes.slice(4, 8))
    .map((b) => chars[b % 36])
    .join("");
  return `${seg1}-${seg2}`;
}

const app = createApp({
  setup() {
    const roomParam = parseRoomParam();

    const state = reactive({
      roomId: roomParam.roomId,
      myName: "",
      myUserId: null,
      hostId: null,
      revealed: false,
      deck: DEFAULT_DECK_KEY,
      selectedDeck: DEFAULT_DECK_KEY,
      users: [],
      votes: null,
      phase: "landing",
      errorMsg: null,
      toast: null,
      myVote: null,
    });

    if (roomParam.present && !roomParam.valid) {
      state.errorMsg = "This room link is invalid";
    }

    let toastTimer = null;
    function showToast(msg) {
      state.toast = msg;
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        state.toast = null;
        toastTimer = null;
      }, 3000);
    }

    const hasRoomParam = computed(() => roomParam.present && roomParam.valid);
    const nameValid = computed(() => {
      const trimmed = state.myName.trim();
      return trimmed.length >= 1 && trimmed.length <= 32;
    });
    const actionLabel = computed(() => {
      if (state.phase === "connecting") return "Connecting\u2026";
      return hasRoomParam.value ? "Join" : "Start";
    });
    const actionDisabled = computed(
      () => !nameValid.value || state.phase === "connecting" || (roomParam.present && !roomParam.valid),
    );

    const activeDeck = computed(() => DECKS[state.deck] ?? DECKS[DEFAULT_DECK_KEY]);
    const cards = computed(() => activeDeck.value.cards);
    const votedCount = computed(
      () => state.users.filter((u) => u.hasVoted).length,
    );

    function sendMsg(msg) {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        showToast("Not connected yet");
        return false;
      }
      socket.send(JSON.stringify(msg));
      return true;
    }

    function sendVote(value) {
      if (sendMsg({ type: "vote", value })) {
        state.myVote = value;
      }
    }

    function sendReveal() {
      sendMsg({ type: "reveal" });
    }

    function sendReset() {
      sendMsg({ type: "reset" });
    }

    function copyInviteLink() {
      const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(state.roomId)}`;
      navigator.clipboard.writeText(url).then(
        () => showToast("Link copied"),
        () => showToast("Couldn\u2019t copy \u2014 copy the URL from the address bar"),
      );
    }

    const isHost = computed(() => state.hostId === state.myUserId);
    const hostName = computed(
      () => state.users.find((u) => u.id === state.hostId)?.name ?? "\u2014",
    );

    function orderIndex(vote) {
      return activeDeck.value.order.indexOf(vote);
    }

    const revealSlots = computed(() => {
      if (!state.revealed || !state.votes) return [];
      return [...state.users]
        .map((u) => ({ id: u.id, name: u.name, vote: state.votes[u.id] ?? null }))
        .sort((a, b) => {
          const aIdx = orderIndex(a.vote);
          const bIdx = orderIndex(b.vote);
          const aScored = aIdx !== -1;
          const bScored = bIdx !== -1;
          if (aScored && bScored) return aIdx - bIdx;
          if (aScored) return -1;
          if (bScored) return 1;
          if (a.vote === "?") return b.vote === "\u2615" ? -1 : 0;
          if (b.vote === "?") return a.vote === "\u2615" ? 1 : 0;
          return 0;
        });
    });

    const revealStats = computed(() => {
      if (!state.revealed || !state.votes) {
        return { average: "\u2014", mode: "\u2014", spread: "\u2014" };
      }
      const votesList = Object.values(state.votes);
      const indices = votesList.map(orderIndex).filter((i) => i !== -1);
      if (indices.length === 0) {
        return { average: "\u2014", mode: "\u2014", spread: "\u2014" };
      }
      const sortedIndices = [...indices].sort((a, b) => a - b);
      const modeIdx = getModeIndex(indices);
      const min = activeDeck.value.order[sortedIndices[0]];
      const max = activeDeck.value.order[sortedIndices[sortedIndices.length - 1]];
      const spread = min === max ? `${min}` : `${min}\u2013${max}`;
      const mode = modeIdx !== null ? activeDeck.value.order[modeIdx] : "\u2014";

      if (activeDeck.value.numeric) {
        const nums = votesList.map((v) => parseFloat(v)).filter((n) => !isNaN(n));
        const sum = nums.reduce((acc, n) => acc + n, 0);
        const avg = nums.length > 0 ? sum / nums.length : null;
        return {
          average: avg !== null ? (avg % 1 === 0 ? `${avg}` : avg.toFixed(1)) : "\u2014",
          mode,
          spread,
        };
      }

      const medianIdx =
        sortedIndices.length % 2 === 1
          ? sortedIndices[(sortedIndices.length - 1) / 2]
          : sortedIndices[sortedIndices.length / 2];
      return {
        average: activeDeck.value.order[medianIdx],
        mode,
        spread,
      };
    });

    function getModeIndex(indices) {
      const freq = {};
      indices.forEach((i) => { freq[i] = (freq[i] || 0) + 1; });
      let maxCount = 0;
      let modeIdx = null;
      Object.entries(freq).forEach(([idxStr, count]) => {
        if (count > maxCount) {
          maxCount = count;
          modeIdx = Number(idxStr);
        }
      });
      return modeIdx;
    }

    function isOutlier(vote) {
      if (!state.revealed || !state.votes) return false;
      const vIdx = orderIndex(vote);
      if (vIdx === -1) return false;
      const indices = Object.values(state.votes).map(orderIndex).filter((i) => i !== -1);
      if (indices.length < 3) return false;
      const modeIdx = getModeIndex(indices);
      if (modeIdx === null) return false;
      return Math.abs(vIdx - modeIdx) > 1;
    }

    const consensusNote = computed(() => {
      if (!state.revealed || !state.votes) return "";
      const indices = Object.values(state.votes).map(orderIndex).filter((i) => i !== -1);
      if (indices.length === 0) return "";
      const sorted = [...indices].sort((a, b) => a - b);
      const minIdx = sorted[0];
      const maxIdx = sorted[sorted.length - 1];
      const modeIdx = getModeIndex(indices);
      const modeLabel = activeDeck.value.order[modeIdx];
      if (maxIdx - minIdx <= 1) {
        return `Consensus \u2014 everyone\u2019s near ${modeLabel}.`;
      }
      const highestEntry = revealSlots.value
        .filter((s) => orderIndex(s.vote) !== -1)
        .reduce(
          (best, s) =>
            orderIndex(s.vote) > (best ? orderIndex(best.vote) : -Infinity) ? s : best,
          null,
        );
      if (highestEntry) {
        return `No consensus \u2014 ${highestEntry.name} is highest at ${highestEntry.vote}. Worth a quick word.`;
      }
      return "No consensus \u2014 spread is wide.";
    });

    let socket = null;

    function connect(name) {
      const roomId = state.roomId;
      let url = `${wsUrl}?room=${encodeURIComponent(roomId)}&name=${encodeURIComponent(name.trim())}`;
      if (!hasRoomParam.value) {
        url += `&deck=${encodeURIComponent(state.selectedDeck)}`;
      }
      state.phase = "connecting";
      socket = new WebSocket(url);

      socket.onopen = () => {};

      socket.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          console.warn("Failed to parse message", event.data);
          return;
        }

        if (!msg || typeof msg.type !== "string") {
          console.warn("Invalid message shape", msg);
          return;
        }

        switch (msg.type) {
          case "welcome":
            if (state.myUserId !== null) {
              console.warn("Duplicate welcome received, ignoring");
              return;
            }
            state.myUserId = msg.userId;
            state.phase = "connected";
            break;

          case "state":
            if (state.myUserId === null) {
              console.warn("state arrived before welcome, discarding");
              return;
            }
            if (!msg.revealed && msg.votes !== null) {
              msg.votes = null;
            }
            if (state.revealed && !msg.revealed) {
              state.myVote = null;
            }
            state.hostId = msg.hostId;
            state.revealed = msg.revealed;
            state.deck = msg.deck ?? DEFAULT_DECK_KEY;
            state.users = msg.users;
            state.votes = msg.votes;
            break;

          case "error":
            showToast(msg.message);
            break;

          default:
            console.warn("Unknown message type", msg.type);
        }
      };

      socket.onerror = () => {};

      socket.onclose = (event) => {
        socket = null;
        state.phase = "disconnected";
        switch (event.code) {
          case 1001:
            state.errorMsg = "Server is restarting. Reload to rejoin.";
            break;
          case 1011:
            state.errorMsg = "Connection timed out. Reload to rejoin.";
            break;
          case 1006:
            state.errorMsg = "Connection lost. Reload to rejoin.";
            break;
          default:
            state.errorMsg = "Disconnected. Reload to rejoin.";
        }
      };
    }

    function handleAction() {
      if (!nameValid.value) return;
      if (!hasRoomParam.value) {
        const id = generateRoomId();
        state.roomId = id;
        history.pushState(null, "", `?room=${id}`);
      }
      connect(state.myName);
    }

    return {
      state,
      showToast,
      hasRoomParam,
      nameValid,
      actionLabel,
      actionDisabled,
      handleAction,
      activeDeck,
      cards,
      votedCount,
      sendVote,
      sendReveal,
      sendReset,
      copyInviteLink,
      isHost,
      hostName,
      revealSlots,
      revealStats,
      isOutlier,
      consensusNote,
    };
  },
});
app.mount("#app");
const loading = document.getElementById("loading");
if (loading) loading.remove();
