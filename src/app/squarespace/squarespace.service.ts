import { Injectable, inject } from '@angular/core';
import { httpsCallable } from 'firebase/functions';
import { Observable, from } from 'rxjs';
import { FirebaseStateService } from '../firebase-state.service';

@Injectable({
    providedIn: 'root'
})
export class SquarespaceService {
    private firebaseState = inject(FirebaseStateService);

    getSquarespaceContent(path: string): Observable<any> {
        const functions = this.firebaseState.functions;
        const getContent = httpsCallable(functions, 'getSquarespaceContent');
        return from(getContent({ path }).then(result => result.data));
    }
}
