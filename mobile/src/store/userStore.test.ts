import { useUserStore } from "./userStore";

beforeEach(() => useUserStore.setState({ lastPage: 1, bookmarks: [], pendingJump: null,
  settings: { language: "en", theme: "light", translationDefault: true, reciterId: 7,
    serverUrl: "http://localhost:8000", offlineFollow: false } }));

test("setLastPage clamps to 1..604", () => {
  useUserStore.getState().setLastPage(999);
  expect(useUserStore.getState().lastPage).toBe(604);
  useUserStore.getState().setLastPage(0);
  expect(useUserStore.getState().lastPage).toBe(1);
});
test("requestJump sets clamped lastPage and pendingJump; clear resets jump", () => {
  useUserStore.getState().requestJump(999);
  expect(useUserStore.getState().lastPage).toBe(604);
  expect(useUserStore.getState().pendingJump).toBe(604);
  useUserStore.getState().clearPendingJump();
  expect(useUserStore.getState().pendingJump).toBeNull();
});
test("toggleBookmark adds then removes", () => {
  const { toggleBookmark } = useUserStore.getState();
  toggleBookmark("2:255");
  expect(useUserStore.getState().bookmarks.map((b) => b.verseKey)).toEqual(["2:255"]);
  toggleBookmark("2:255");
  expect(useUserStore.getState().bookmarks).toEqual([]);
});
