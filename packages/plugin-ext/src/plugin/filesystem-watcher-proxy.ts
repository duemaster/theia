/********************************************************************************
 * Copyright (C) 2018 Red Hat, Inc. and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/

import * as theia from '@theia/plugin';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { WorkspaceMain } from '../api/plugin-api';
import { FileWatcherSubscriberOptions, FileChangeEventType } from '../api/model';
import URI from 'vscode-uri';

export class InPluginFileSystemWatcherProxy {

    private proxy: WorkspaceMain;
    private subscribers: Map<string, Emitter<FileSystemEvent>>;

    constructor(proxy: WorkspaceMain) {
        this.proxy = proxy;
        this.subscribers = new Map<string, Emitter<FileSystemEvent>>();
    }

    createFileSystemWatcher(
        globPattern: theia.GlobPattern,
        ignoreCreateEvents?: boolean,
        ignoreChangeEvents?: boolean,
        ignoreDeleteEvents?: boolean): theia.FileSystemWatcher {

        const perSubscriberEventEmitter = new Emitter<FileSystemEvent>();
        const subscriberPrivateData: SubscriberData = {
            event: perSubscriberEventEmitter.event
        };
        const fileWatcherSubscriberOptions: FileWatcherSubscriberOptions = { globPattern, ignoreCreateEvents, ignoreChangeEvents, ignoreDeleteEvents };
        // ids are generated by server side to be able handle several subscribers.
        this.proxy.$registerFileSystemWatcher(fileWatcherSubscriberOptions).then((id: string) => {
            // this is safe, because actual subscription happans on server side and response is
            // sent right after actual subscription, so no events are possible in between.
            console.log('>>>> PLUGIN: Got watcher id: ', id);
            this.subscribers.set(id, perSubscriberEventEmitter);
            subscriberPrivateData.unsubscribe = () => this.proxy.$unregisterFileSystemWatcher(id);
        });
        return new FileSystemWatcher(subscriberPrivateData, ignoreCreateEvents, ignoreChangeEvents, ignoreDeleteEvents);
    }

    onFileSystemEvent(id: string, uri: URI, type: FileChangeEventType) {
        const perSubscriberEventEmitter: Emitter<FileSystemEvent> | undefined = this.subscribers.get(id);
        if (perSubscriberEventEmitter) {
            perSubscriberEventEmitter.fire({ uri, type });
        } else {
            // shouldn't happen
            // if it happans then a message was lost, unsubscribe to make state consistent
            this.proxy.$unregisterFileSystemWatcher(id);
        }
    }
}

class FileSystemWatcher implements theia.FileSystemWatcher {
    private subscriberData: SubscriberData;

    private isIgnoreCreateEvents: boolean;
    private isIgnoreChangeEvents: boolean;
    private isIgnoreDeleteEvents: boolean;

    private onDidCreateEmitter: Emitter<theia.Uri>;
    private onDidChangeEmitter: Emitter<theia.Uri>;
    private onDidDeleteEmitter: Emitter<theia.Uri>;

    constructor(
        subscriberData: SubscriberData,
        ignoreCreateEvents: boolean = false,
        ignoreChangeEvents: boolean = false,
        ignoreDeleteEvents: boolean = false
    ) {
        this.isIgnoreCreateEvents = ignoreCreateEvents;
        this.isIgnoreChangeEvents = ignoreChangeEvents;
        this.isIgnoreDeleteEvents = ignoreDeleteEvents;

        this.onDidCreateEmitter = new Emitter<theia.Uri>();
        this.onDidChangeEmitter = new Emitter<theia.Uri>();
        this.onDidDeleteEmitter = new Emitter<theia.Uri>();

        this.subscriberData = subscriberData;
        subscriberData.event((event: FileSystemEvent) => {
            // Here ignore event flags are not analyzed because all the logic is
            // moved to server side to avoid unneded data transfer via network.
            // The flags are present just to be read only accesible for user.
            console.log('>>>> PLUGIN: fire watcher event to user');
            switch (event.type) {
                case 'updated':
                    this.onDidChangeEmitter.fire(event.uri);
                    break;
                case 'created':
                    this.onDidCreateEmitter.fire(event.uri);
                    break;
                case 'deleted':
                    this.onDidDeleteEmitter.fire(event.uri);
                    break;
            }
        });
    }

    get ignoreCreateEvents(): boolean {
        return this.isIgnoreCreateEvents;
    }

    get ignoreChangeEvents(): boolean {
        return this.isIgnoreChangeEvents;
    }

    get ignoreDeleteEvents(): boolean {
        return this.isIgnoreDeleteEvents;
    }

    get onDidCreate(): Event<theia.Uri> {
        return this.onDidCreateEmitter.event;
    }

    get onDidChange(): Event<theia.Uri> {
        return this.onDidChangeEmitter.event;
    }

    get onDidDelete(): Event<theia.Uri> {
        return this.onDidDeleteEmitter.event;
    }

    dispose(): void {
        if (this.subscriberData.unsubscribe) {
            this.subscriberData.unsubscribe();
        }
    }

}

interface FileSystemEvent {
    uri: URI,
    type: FileChangeEventType
}

interface SubscriberData {
    event: Event<FileSystemEvent>
    unsubscribe?: () => void;
}
