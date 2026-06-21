import type { ElementTarget } from "../types";

const dataAttributes = ["data-testid", "data-test", "data-cy", "data-qa"];

export function getElementTarget(element: Element | null): ElementTarget {
  if (!element) {
    return {
      elementSelector: null,
      elementId: null,
      dataSelector: null,
      xpath: null
    };
  }

  const elementId = element.id ? `#${CSS.escape(element.id)}` : null;
  const dataSelector = getDataSelector(element);
  const xpath = getXPath(element);

  return {
    elementSelector: elementId || dataSelector || xpath,
    elementId,
    dataSelector,
    xpath
  };
}

export function resolveElement(documentRef: Document, target: ElementTarget) {
  const selectors = [target.elementId, target.dataSelector].filter(Boolean) as string[];

  for (const selector of selectors) {
    const element = documentRef.querySelector(selector);
    if (element) {
      return element;
    }
  }

  if (target.xpath) {
    const result = documentRef.evaluate(
      target.xpath,
      documentRef,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );

    if (result.singleNodeValue instanceof Element) {
      return result.singleNodeValue;
    }
  }

  return null;
}

function getDataSelector(element: Element) {
  for (const attributeName of dataAttributes) {
    const value = element.getAttribute(attributeName);
    if (value) {
      return `[${attributeName}="${CSS.escape(value)}"]`;
    }
  }

  return null;
}

function getXPath(element: Element) {
  const segments: string[] = [];
  let current: Element | null = element;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    const tagName = current.tagName.toLowerCase();
    let index = 1;
    let sibling = current.previousElementSibling;

    while (sibling) {
      if (sibling.tagName.toLowerCase() === tagName) {
        index += 1;
      }
      sibling = sibling.previousElementSibling;
    }

    segments.unshift(`${tagName}[${index}]`);
    current = current.parentElement;
  }

  return segments.length ? `/${segments.join("/")}` : null;
}
