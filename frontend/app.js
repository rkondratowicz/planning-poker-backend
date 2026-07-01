import { createApp, ref } from "vue";

createApp({
  setup() {
    const phase = ref("landing");
    return { phase };
  },
}).mount("#app");
