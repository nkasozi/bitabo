import './view.js'
import { createTOCView } from './ui/tree.js'
import { createMenu } from './ui/menu.js'
import { Overlayer } from './overlayer.js'

// types.ts
type StyleConfig = {
    spacing: number,
    justify: boolean,
    hyphenate: boolean
}

type BookMetadata = {
    title?: string | Record<string, string>,
  author?: string | Array<string | {name: string}>,
  language?: string
}

type AnnotationType = {
    value: string,
    color: string,
    note?: string
}

type LocationInfo = {
    current: number
}

type TocItem = {
    href: string
}

type PageItem = {
    label: string
}

type RelocateEvent = {
    fraction: number,
    location: LocationInfo,
    tocItem?: TocItem,
    pageItem?: PageItem
}

// formatters.ts
class TextFormatters {
    private static readonly DEFAULT_LOCALE = 'en'
    private percentFormatter: Intl.NumberFormat
    private listFormatter: Intl.ListFormat

    constructor(locale: string = TextFormatters.DEFAULT_LOCALE) {
        this.percentFormatter = new Intl.NumberFormat(locale, {
            style: 'percent'
        })
        this.listFormatter = new Intl.ListFormat(locale, {
            style: 'short',
            type: 'conjunction'
        })
    }

    formatPercentage(value: number): string {
        return this.percentFormatter.format(value)
    }

    formatList(items: string[]): string {
        return this.listFormatter.format(items)
    }
}

// styles.ts
class ReaderStyleGenerator {
    static generateStyles(config: StyleConfig): string {
        return `
            @namespace epub "http://www.idpf.org/2007/ops";
            html {
                color-scheme: light dark;
            }
            @media (prefers-color-scheme: dark) {
                a:link {
                    color: lightblue;
                }
            }
            p, li, blockquote, dd {
                line-height: ${config.spacing};
                text-align: ${config.justify ? 'justify' : 'start'};
                -webkit-hyphens: ${config.hyphenate ? 'auto' : 'manual'};
                hyphens: ${config.hyphenate ? 'auto' : 'manual'};
                -webkit-hyphenate-limit-before: 3;
                -webkit-hyphenate-limit-after: 2;
                -webkit-hyphenate-limit-lines: 2;
                hanging-punctuation: allow-end last;
                widows: 2;
            }
            [align="left"] { text-align: left; }
            [align="right"] { text-align: right; }
            [align="center"] { text-align: center; }
            [align="justify"] { text-align: justify; }

            pre {
                white-space: pre-wrap !important;
            }
            aside[epub|type~="endnote"],
            aside[epub|type~="footnote"],
            aside[epub|type~="note"],
            aside[epub|type~="rearnote"] {
                display: none;
            }
        `
    }
}

// book-metadata.ts
class BookMetadataFormatter {
    static formatLanguageMap(text: string | Record<string, string> | undefined): string {
        if (!text) return ''
        if (typeof text === 'string') return text
        const [firstKey] = Object.keys(text)
        return text[firstKey]
    }

    static formatContributor(contributor: string | Array<string | { name: string }> | undefined): string {
        const formatters = new TextFormatters()

        const formatSingleContributor = (cont: string | {name: string}): string =>
          typeof cont === 'string' ? cont : BookMetadataFormatter.formatLanguageMap(cont?.name)

        if (Array.isArray(contributor)) {
            return formatters.formatList(contributor.map(formatSingleContributor))
        }
        return formatSingleContributor(contributor)
    }
}

// reader.ts
class EbookReader {
    private tocView: any
    private view: any
    private defaultStyle: StyleConfig = {
        spacing: 1.4,
        justify: true,
        hyphenate: true,
    }
    private  annotations: Map<number, AnnotationType[]> = new Map()
    private  annotationsByValue: Map<string, AnnotationType> = new Map()
    private  formatters: TextFormatters = new TextFormatters()

    constructor() {
        this.initializeUserInterface()
    }

    private initializeUserInterface(): void {
        this.setupSidebarControls()
        this.setupLayoutMenu()
    }

    private setupSidebarControls(): void {
        const sidebarButton = document.querySelector('#side-bar-button')
        const dimmingOverlay = document.querySelector('#dimming-overlay')

        sidebarButton?.addEventListener('click', () => this.showSidebar())
        dimmingOverlay?.addEventListener('click', () => this.hideSidebar())
    }

    private showSidebar(): void {
        document.querySelector('#dimming-overlay')?.classList.add('show')
        document.querySelector('#side-bar')?.classList.add('show')
    }

    private hideSidebar(): void {
        document.querySelector('#dimming-overlay')?.classList.remove('show')
        document.querySelector('#side-bar')?.classList.remove('show')
    }

    private setupLayoutMenu(): void {
        const menu = createMenu([{
            name: 'layout',
            label: 'Layout',
            type: 'radio',
            items: [
                ['Paginated', 'paginated'],
                ['Scrolled', 'scrolled'],
            ],
            onclick: (value: string) => this.updateLayoutFlow(value)
        }])

        this.appendMenuToInterface(menu)
    }

    private updateLayoutFlow(value: string): void {
        this.view?.renderer.setAttribute('flow', value)
    }

    private appendMenuToInterface(menu: any): void {
        const menuButton = document.querySelector('#menu-button')
        menu.element.classList.add('menu')
        menuButton?.append(menu.element)

        const button = menuButton?.querySelector('button')
        button?.addEventListener('click', () => menu.element.classList.toggle('show'))

        menu.groups.layout.select('paginated')
    }

    async openBook(file: File | string): Promise<void> {
        this.view = document.createElement('foliate-view')
        const container = document.querySelector('#ebook-container')

        if (!container) throw new Error('Ebook container not found')

        container.appendChild(this.view)
        container.classList.add('book-loaded')

        await this.initializeBookView(file)
        await this.setupBookInterface()
        await this.loadBookMetadata()
        await this.loadAnnotations()
    }

    private async initializeBookView(file: File | string): Promise<void> {
        await this.view.open(file)
        this.view.addEventListener('load', this.handleBookLoad.bind(this))
        this.view.addEventListener('relocate', this.handleBookRelocate.bind(this))
        this.view.renderer.setStyles?.(ReaderStyleGenerator.generateStyles(this.defaultStyle))
        this.view.renderer.next()
    }

    private setupBookInterface(): void {
        this.showNavigationControls()
        this.setupProgressSlider()
        this.setupKeyboardNavigation()
    }

    private showNavigationControls(): void {
        const headerBar = document.querySelector('#header-bar')
        const navBar = document.querySelector('#nav-bar')

        if (headerBar) headerBar['style'].visibility = 'visible'
        if (navBar) navBar['style'].visibility = 'visible'

        this.setupNavigationButtons()
    }

    private setupNavigationButtons(): void {
        document.querySelector('#left-button')
          ?.addEventListener('click', () => this.view.goLeft())
        document.querySelector('#right-button')
          ?.addEventListener('click', () => this.view.goRight())
    }

    private setupProgressSlider(): void {
        const slider = document.querySelector('#progress-slider') as HTMLInputElement
        if (!slider) return

        slider.dir = this.view.book.dir
        slider.addEventListener('input', (e) => {
            const target = e.target as HTMLInputElement
            this.view.goToFraction(parseFloat(target.value))
        })

        this.addTickMarksToSlider()
    }

    private addTickMarksToSlider(): void {
        const tickMarks = document.querySelector('#tick-marks')
        if (!tickMarks) return

        for (const fraction of this.view.getSectionFractions()) {
            const option = document.createElement('option')
            option.value = fraction.toString()
            tickMarks.append(option)
        }
    }

    private setupKeyboardNavigation(): void {
        document.addEventListener('keydown', this.handleKeyboardNavigation.bind(this))
    }

    private handleKeyboardNavigation(event: KeyboardEvent): void {
        switch (event.key) {
            case 'ArrowLeft':
            case 'h':
                this.view.goLeft()
                break
            case 'ArrowRight':
            case 'l':
                this.view.goRight()
                break
        }
    }

    private async loadBookMetadata(): Promise<void> {
        const { book } = this.view
        const metadata = book.metadata

        this.updateBookTitle(metadata)
        this.updateAuthorInfo(metadata)
        await this.loadCoverImage(book)
        await this.loadTableOfContents(book)
    }

    private updateBookTitle(metadata: BookMetadata): void {
        const title = BookMetadataFormatter.formatLanguageMap(metadata?.title) || 'Untitled Book'
        document.title = title
        document.querySelector('#side-bar-title').textContent = title
    }

    private updateAuthorInfo(metadata: BookMetadata): void {
        const authorElement = document.querySelector('#side-bar-author')
        if (authorElement) {
            authorElement.textContent = BookMetadataFormatter.formatContributor(metadata?.author)
        }
    }

    private async loadCoverImage(book: any): Promise<void> {
        const coverBlob = await book.getCover?.()
        if (coverBlob) {
            const coverImage = document.querySelector('#side-bar-cover') as HTMLImageElement
            if (coverImage) {
                coverImage.src = URL.createObjectURL(coverBlob)
            }
        }
    }

    private async loadTableOfContents(book: any): Promise<void> {
        const toc = book.toc
        if (!toc) return

        this.tocView = createTOCView(toc, (href: string) => {
            this.view.goTo(href).catch(console.error)
            this.hideSidebar()
        })

        document.querySelector('#toc-view')?.append(this.tocView.element)
    }

    private async loadAnnotations(): Promise<void> {
        const bookmarks = await this.view.book.getCalibreBookmarks?.()
        if (!bookmarks) return

        const { fromCalibreHighlight } = await import('./epubcfi.js')

        this.processBookmarks(bookmarks, fromCalibreHighlight)
        this.setupAnnotationEventListeners()
    }

    private processBookmarks(bookmarks: any[], fromCalibreHighlight: Function): void {
        for (const bookmark of bookmarks) {
            if (bookmark.type !== 'highlight') continue

            const annotation = {
                value: fromCalibreHighlight(bookmark),
                color: bookmark.style.which,
                note: bookmark.notes
            }

            this.storeAnnotation(bookmark.spine_index, annotation)
        }
    }

    private storeAnnotation(index: number, annotation: AnnotationType): void {
        const existingAnnotations = this.annotations.get(index) || []
        existingAnnotations.push(annotation)
        this.annotations.set(index, existingAnnotations)
        this.annotationsByValue.set(annotation.value, annotation)
    }

    private setupAnnotationEventListeners(): void {
        this.view.addEventListener('create-overlay', this.handleCreateOverlay.bind(this))
        this.view.addEventListener('draw-annotation', this.handleDrawAnnotation.bind(this))
        this.view.addEventListener('show-annotation', this.handleShowAnnotation.bind(this))
    }

    private handleCreateOverlay(event: CustomEvent): void {
        const { index } = event.detail
        const annotations = this.annotations.get(index)
        if (annotations) {
            annotations.forEach(annotation => this.view.addAnnotation(annotation))
        }
    }

    private handleDrawAnnotation(event: CustomEvent): void {
        const { draw, annotation } = event.detail
        draw(Overlayer.highlight, { color: annotation.color })
    }

    private handleShowAnnotation(event: CustomEvent): void {
        const annotation = this.annotationsByValue.get(event.detail.value)
        if (annotation?.note) {
            alert(annotation.note)
        }
    }

    private handleBookLoad(event: CustomEvent): void {
        const { doc } = event.detail
        doc.addEventListener('keydown', this.handleKeyboardNavigation.bind(this))
    }

    private handleBookRelocate(event: CustomEvent<RelocateEvent>): void {
        const { fraction, location, tocItem, pageItem } = event.detail

        const percent = this.formatters.formatPercentage(fraction)
        const locationText = pageItem
          ? `Page ${pageItem.label}`
          : `Loc ${location.current}`

        this.updateProgressSlider(fraction, percent, locationText)

        if (tocItem?.href) {
            this.tocView?.setCurrentHref?.(tocItem.href)
        }
    }

    private updateProgressSlider(
      fraction: number,
      percent: string,
      locationText: string
    ): void {
        const slider = document.querySelector('#progress-slider') as HTMLInputElement
        if (!slider) return

        slider.style.visibility = 'visible'
        slider.value = fraction.toString()
        slider.title = `${percent} · ${locationText}`
    }
}

// initialization.ts
const initializeReader = async (file: File | string): Promise<void> => {
    const reader = new EbookReader()
    globalThis.reader = reader
    await reader.openBook(file)
}

const handleFileDrop = (event: DragEvent): void => {
    event.preventDefault()

    const items = Array.from(event.dataTransfer?.items || [])
    const fileItem = items.find(item => item.kind === 'file')

    if (!fileItem) return

    const entry = fileItem.webkitGetAsEntry()
    const file = entry?.isFile ? fileItem.getAsFile() : entry

    if (file) {
        initializeReader(file).catch(console.error)
    }
}

const setupFileHandlers = (): void => {
    const fileInput = document.querySelector('#file-input') as HTMLInputElement
    const fileButton = document.querySelector('#file-button')
    const dropTarget = document.querySelector('#drop-target')

    if (!fileInput || !fileButton || !dropTarget) return

    fileInput.addEventListener('change', (event) => {
        const target = event.target as HTMLInputElement
        const file = target.files?.[0]
        if (file) {
            initializeReader(file).catch(console.error)
        }
    })

    fileButton.addEventListener('click', () => fileInput.click())
    dropTarget.addEventListener('drop', handleFileDrop)
    dropTarget.addEventListener('dragover', (e) => e.preventDefault())
}

// initialization.ts (continued)
const initialize = (): void => {
    const urlParams = new URLSearchParams(location.search)
    const urlFile = urlParams.get('url')
    const dropTarget = document.querySelector('#drop-target')

    if (urlFile) {
        initializeReader(urlFile).catch(console.error)
    } else if (dropTarget) {
        dropTarget['style'].visibility = 'visible'
    }

    setupFileHandlers()
}

// Start the application
initialize()