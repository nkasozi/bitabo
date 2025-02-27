export interface ReaderConfiguration {
    containerSelector: string;
    elements: {
        dropTarget: string;
        sidebar: {
            container: string;
            button: string;
            title: string;
            author: string;
            cover: string;
            tocView: string;
        };
        navigation: {
            headerBar: string;
            navBar: string;
            leftButton: string;
            rightButton: string;
            progressSlider: string;
            tickMarks: string;
        };
        menu: {
            container: string;
            button: string;
        };
        overlay: string;
    };
    defaultStyle?: {
        spacing: number;
        justify: boolean;
        hyphenate: boolean;
    };
}

export interface BookCoverExtractOptions {
    extractCoverOnly?: boolean;
}

export interface Book {
    cover?: string;
    title?: string;
    author?: string;
    file?: File;
}