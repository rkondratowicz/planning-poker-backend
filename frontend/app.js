import { createApp, ref, reactive, computed } from "vue";

const DEV_WS_URL = "ws://localhost:3000/ws";
const PROD_WS_URL = "wss://planning-poker-backend.onrender.com/ws";
const wsUrl =
  location.hostname === "localhost" ? DEV_WS_URL : PROD_WS_URL;

const ROOM_ID_REGEX = /^[a-z0-9]{4,32}(-[a-z0-9]{4,32})*$/;

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

    const deck = ["0", "1", "2", "3", "5", "8", "13", "21", "34", "55", "89", "?", "\u2615"];
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

    const FIBONACCI = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89];

    const revealSlots = computed(() => {
      if (!state.revealed || !state.votes) return [];
      return [...state.users]
        .map((u) => ({ id: u.id, name: u.name, vote: state.votes[u.id] ?? null }))
        .sort((a, b) => {
          const aNum = parseFloat(a.vote);
          const bNum = parseFloat(b.vote);
          const aIsNum = !isNaN(aNum);
          const bIsNum = !isNaN(bNum);
          if (aIsNum && bIsNum) return aNum - bNum;
          if (aIsNum) return -1;
          if (bIsNum) return 1;
          if (a.vote === "?") return b.vote === "\u2615" ? -1 : 0;
          if (b.vote === "?") return a.vote === "\u2615" ? 1 : 0;
          return 0;
        });
    });

    const revealStats = computed(() => {
      if (!state.revealed || !state.votes) {
        return { average: "\u2014", mode: "\u2014", spread: "\u2014" };
      }
      const nums = Object.values(state.votes)
        .map((v) => parseFloat(v))
        .filter((n) => !isNaN(n));
      if (nums.length === 0) {
        return { average: "\u2014", mode: "\u2014", spread: "\u2014" };
      }
      const sorted = [...nums].sort((a, b) => a - b);
      const sum = sorted.reduce((acc, n) => acc + n, 0);
      const avg = sum / sorted.length;
      const mode = getMode(nums);
      const min = sorted[0];
      const max = sorted[sorted.length - 1];
      const spread = min === max ? `${min}` : `${min}\u2013${max}`;
      return {
        average: avg % 1 === 0 ? `${avg}` : avg.toFixed(1),
        mode: mode !== null ? (mode % 1 === 0 ? `${mode}` : mode.toFixed(1)) : "\u2014",
        spread,
      };
    });

    function getMode(nums) {
      const freq = {};
      nums.forEach((n) => { freq[n] = (freq[n] || 0) + 1; });
      let maxCount = 0;
      let mode = null;
      Object.entries(freq).forEach(([val, count]) => {
        if (count > maxCount) {
          maxCount = count;
          mode = parseFloat(val);
        }
      });
      return mode;
    }

    function isOutlier(vote) {
      if (!state.revealed || !state.votes) return false;
      const v = parseFloat(vote);
      if (isNaN(v)) return false;
      const nums = Object.values(state.votes)
        .map((x) => parseFloat(x))
        .filter((n) => !isNaN(n));
      if (nums.length < 3) return false;
      const mode = getMode(nums);
      if (mode === null) return false;
      const modeIdx = FIBONACCI.indexOf(mode);
      const vIdx = FIBONACCI.indexOf(v);
      if (modeIdx === -1 || vIdx === -1) return Math.abs(v - mode) > mode * 0.5;
      return Math.abs(vIdx - modeIdx) > 1;
    }

    const consensusNote = computed(() => {
      if (!state.revealed || !state.votes) return "";
      const nums = Object.values(state.votes)
        .map((v) => parseFloat(v))
        .filter((n) => !isNaN(n));
      if (nums.length === 0) return "";
      const sorted = [...nums].sort((a, b) => a - b);
      const min = sorted[0];
      const max = sorted[sorted.length - 1];
      const mode = getMode(nums);
      const minIdx = FIBONACCI.indexOf(min);
      const maxIdx = FIBONACCI.indexOf(max);
      const withinOneStep =
        minIdx !== -1 && maxIdx !== -1
          ? maxIdx - minIdx <= 1
          : max - min <= 1;
      if (withinOneStep) {
        return `Consensus \u2014 everyone\u2019s near ${mode}.`;
      }
      const highestEntry = revealSlots.value
        .filter((s) => !isNaN(parseFloat(s.vote)))
        .reduce(
          (best, s) =>
            parseFloat(s.vote) > (best ? parseFloat(best.vote) : -Infinity)
              ? s
              : best,
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
      const url = `${wsUrl}?room=${encodeURIComponent(roomId)}&name=${encodeURIComponent(name.trim())}`;
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
      deck,
      votedCount,
      sendVote,
      sendReveal,
      sendReset,
      copyInviteLink,
      isHost,
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
