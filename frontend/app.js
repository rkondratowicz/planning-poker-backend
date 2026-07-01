import { createApp, ref } from "vue";

const app = createApp({
  setup() {
    const phase = ref("landing");
    return { phase };
  },
});
app.mount("#app");
const loading = document.getElementById("loading");
if (loading) loading.remove();
