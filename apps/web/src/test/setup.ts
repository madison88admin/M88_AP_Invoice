import '@testing-library/jest-dom';

// jsdom does not implement element scrolling. Components like Dashboard call
// scrollTo/scrollIntoView on mount or interaction, so stub them as no-ops.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
