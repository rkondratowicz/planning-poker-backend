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

    function sendVote(value) {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        showToast("Not connected yet");
        return;
      }
      socket.send(JSON.stringify({ type: "vote", value }));
      state.myVote = value;
    }

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
    };
  },
});
app.mount("#app");
const loading = document.getElementById("loading");
if (loading) loading.remove();
