import { useUserStore } from "./userStore";

beforeEach(() => useUserStore.setState({ lastPage: 1, bookmarks: [],
  settings: { language: "en", theme: "light", translationDefault: true } }));

test("setLastPage clamps to 1..604", () => {
  useUserStore.getState().setLastPage(999);
  expect(useUserStore.getState().lastPage).toBe(604);
  useUserStore.getState().setLastPage(0);
  expect(useUserStore.getState().lastPage).toBe(1);
});
test("toggleBookmark adds then removes", () => {
  const { toggleBookmark } = useUserStore.getState();
  toggleBookmark("2:255");
  expect(useUserStore.getState().bookmarks.map((b) => b.verseKey)).toEqual(["2:255"]);
  toggleBookmark("2:255");
  expect(useUserStore.getState().bookmarks).toEqual([]);
});
