export namespace app {
	
	export class AppInfo {
	    hardwareInfo: string;
	    osVersion: string;
	    appVersion: string;
	
	    static createFrom(source: any = {}) {
	        return new AppInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hardwareInfo = source["hardwareInfo"];
	        this.osVersion = source["osVersion"];
	        this.appVersion = source["appVersion"];
	    }
	}
	export class BootstrapPayload {
	    defaultPath: string;
	    supportedImages: string[];
	    supportedDocuments: string[];
	    supportedMedia: string[];
	    supportedPacks: string[];
	
	    static createFrom(source: any = {}) {
	        return new BootstrapPayload(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.defaultPath = source["defaultPath"];
	        this.supportedImages = source["supportedImages"];
	        this.supportedDocuments = source["supportedDocuments"];
	        this.supportedMedia = source["supportedMedia"];
	        this.supportedPacks = source["supportedPacks"];
	    }
	}
	export class ImageEntry {
	    id: string;
	    name: string;
	    path: string;
	    directoryPath: string;
	    source: string;
	    archivePath?: string;
	    innerPath?: string;
	    format: string;
	    kind: string;
	    size: number;
	
	    static createFrom(source: any = {}) {
	        return new ImageEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.path = source["path"];
	        this.directoryPath = source["directoryPath"];
	        this.source = source["source"];
	        this.archivePath = source["archivePath"];
	        this.innerPath = source["innerPath"];
	        this.format = source["format"];
	        this.kind = source["kind"];
	        this.size = source["size"];
	    }
	}
	export class LibraryNode {
	    id: string;
	    name: string;
	    path: string;
	    kind: string;
	    scanned: boolean;
	    images: ImageEntry[];
	    children: LibraryNode[];
	
	    static createFrom(source: any = {}) {
	        return new LibraryNode(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.path = source["path"];
	        this.kind = source["kind"];
	        this.scanned = source["scanned"];
	        this.images = this.convertValues(source["images"], ImageEntry);
	        this.children = this.convertValues(source["children"], LibraryNode);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DirectoryScanResult {
	    rootPath: string;
	    node?: LibraryNode;
	    warnings: string[];
	
	    static createFrom(source: any = {}) {
	        return new DirectoryScanResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.rootPath = source["rootPath"];
	        this.node = this.convertValues(source["node"], LibraryNode);
	        this.warnings = source["warnings"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DocumentPayload {
	    id: string;
	    name: string;
	    text: string;
	    format: string;
	    source: string;
	    location: string;
	
	    static createFrom(source: any = {}) {
	        return new DocumentPayload(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.text = source["text"];
	        this.format = source["format"];
	        this.source = source["source"];
	        this.location = source["location"];
	    }
	}
	export class DuplicateGroup {
	    hash: string;
	    totalBytes: number;
	    images: ImageEntry[];
	
	    static createFrom(source: any = {}) {
	        return new DuplicateGroup(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hash = source["hash"];
	        this.totalBytes = source["totalBytes"];
	        this.images = this.convertValues(source["images"], ImageEntry);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ExportResult {
	    destination: string;
	    exported: number;
	    skipped: number;
	
	    static createFrom(source: any = {}) {
	        return new ExportResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.destination = source["destination"];
	        this.exported = source["exported"];
	        this.skipped = source["skipped"];
	    }
	}
	
	export class ImagePayload {
	    id: string;
	    name: string;
	    mime: string;
	    dataUri: string;
	    source: string;
	    location: string;
	
	    static createFrom(source: any = {}) {
	        return new ImagePayload(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.mime = source["mime"];
	        this.dataUri = source["dataUri"];
	        this.source = source["source"];
	        this.location = source["location"];
	    }
	}

}
